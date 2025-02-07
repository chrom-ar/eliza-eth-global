import { Action, Memory, IAgentRuntime, MemoryManager, State, HandlerCallback, elizaLogger } from '@elizaos/core';
import { Coinbase, Wallet, ExternalAddress } from '@coinbase/coinbase-sdk';
import { CdpWalletProvider, CHAIN_ID_TO_NETWORK_ID } from '@coinbase/agentkit';

export const confirmIntentAction: Action = {
  name: 'CONFIRM_INTENT',
  similes: ['INTENT_CONFIRMATION', 'CONFIRM_SWAP'],
  description: 'Checks if user wants to confirm the intent and proceed with broadcasting',

  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const text = message.content.text.toLowerCase();
    return /\b(confirm|yes|ok|go|proceed)\b/i.test(text);
  },

  handler: async (runtime: IAgentRuntime, message: Memory, _state: State, _options, callback: HandlerCallback): Promise<boolean> => {
    // 1. Get the stored (pending) intent
    const intentManager = new MemoryManager({ runtime, tableName: 'intents' });
    const [intentMemory] = await intentManager.getMemories({
      roomId: message.roomId,
      count: 1,
      unique: true
    });

    if (typeof intentMemory?.content?.intent !== 'object') {
      callback({ text: 'Sorry, I could not find a pending intent to confirm. Please create a new request.' });
      return false;
    }

    // Initialize memory manager for wallets
    const walletManager = new MemoryManager({
      runtime,
      tableName: 'wallets'
    });

    // Check if user already has a wallet
    // @ts-ignore
    const [existingWallet] = await walletManager.getMemories({ roomId: message.roomId, count: 1 });

    if (!existingWallet) {
      callback({ text: 'Sorry, We need a wallet to continue. Do you want me to create a wallet?' });
      return false;
    }

    Coinbase.configure({
      apiKeyName:      runtime.getSetting("CHROMA_CDP_API_KEY_NAME"),
      privateKey:      runtime.getSetting("CHROMA_CDP_API_KEY_PRIVATE_KEY"),
      useServerSigner: true // By default we'll use the server signer
    });

    let wallet;
    try {
      wallet = await Wallet.fetch(existingWallet.content.walletId as string);
    } catch (error) {
      console.log(error)
      elizaLogger.error('Error importing existing wallet:', error);
      // If import fails, continue to create new wallet
    }

    const intent = intentMemory.content.intent;

    await intentManager.removeMemory(intentMemory.id);

    // Simple transfer
    // @ts-ignore
    if (intent.type === 'TRANSFER') {
      try {
        // @ts-ignore
        const tx = await wallet.createTransfer({
          // @ts-ignore
          assetId:     intent.token.toLowerCase(),
          // @ts-ignore
          destination: intent.toAddress,
          // @ts-ignore
          amount:      intent.amount
        });

        await tx.wait();

        callback({ text: `Transfer successful! \n${tx.model.transaction.transaction_link}` });
        return false
      } catch (error) {
        console.log(error)
        elizaLogger.error('Error creating transfer:', error);
        callback({ text: 'Sorry, there was an error creating the transfer. Please try again.' });
        return false;
      }
    }

    // Excecute intent via wallet provider
    const networkId = await wallet.getNetworkId()
    const chainId = Object.keys(CHAIN_ID_TO_NETWORK_ID).find(
      k => CHAIN_ID_TO_NETWORK_ID[k] === networkId
    );
    const walletAddr = (await wallet.getDefaultAddress()).id
    // @ts-ignore
    let provider = new CdpWalletProvider({
      wallet,
      address: walletAddr,
      network: {
        protocolFamily: "evm",
        chainId,
        networkId
      }
    });

    try {
        // @ts-ignore
      const transactions = intent.transactions || []
        // @ts-ignore
      if (intent.transaction)
        // @ts-ignore
        transactions.push(intent.transaction)

      const links = {}

      let i = 1;
      for (let transaction of transactions) {
        // tx = await provider.sendTransaction(intent.transaction);
        // TMP: Default agent SDK fails with `provider.sendTransaction`
        const preparedTransaction = await provider.prepareTransaction(
          transaction.to,
          transaction.value,
          transaction.data
        )
        const signature = await provider.signTransaction({...preparedTransaction})
        const signedPayload = await provider.addSignatureAndSerialize(preparedTransaction, signature)
        const extAddr = new ExternalAddress( networkId, walletAddr)
        const tx = await extAddr.broadcastExternalTransaction(signedPayload.slice(2))

        // @ts-ignore
        links[i] = tx.transaction_link
        i += 1
      }

      let links_str;
      for (const [i, link] of Object.entries(links)) {
        links_str += `${i}: ${link}\n`
      }

      // @ts-ignore
      callback({ text: `Transactions completed! \n${links_str}` });
      return false
    } catch (error) {
      console.log(error)
      elizaLogger.error('Error sending transactions:', error);
      callback({ text: 'Sorry, there was an error creating the transfer. Please try again.' });
      return false;
    }
  },

  examples: [
    [
      {
        user: '{{user1}}',
        content: { text: 'Yes, confirm' }
      },
      {
        user: '{{user2}}',
        content: {
          text: 'Sending your intent...',
          action: 'CONFIRM_INTENT'
        }
      }
    ],
    [
      {
        user: '{{user1}}',
        content: { text: 'Yes' }
      },
      {
        user: '{{user2}}',
        content: {
          text: 'Sending your intent...',
          action: 'CONFIRM_INTENT'
        }
      }
    ]
  ]
};
