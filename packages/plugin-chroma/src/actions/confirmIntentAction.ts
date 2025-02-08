import { Action, Memory, IAgentRuntime, MemoryManager, State, HandlerCallback, elizaLogger } from '@elizaos/core';
import { Coinbase, Wallet, ExternalAddress } from '@coinbase/coinbase-sdk';
import { CdpWalletProvider, CHAIN_ID_TO_NETWORK_ID } from '@coinbase/agentkit';

import { getWalletProvider, sendTransaction } from '../utils';

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

    const intent = intentMemory.content.intent;
    const proposal = intentMemory.content.proposal;

    if (intent && typeof intent !== 'object') {
      callback({ text: 'Sorry, I could not find a pending intent to confirm. Please create a new request.' });
      return false;
    } else if (proposal && typeof proposal !== 'object') {
      callback({ text: 'Sorry, I could not find a pending proposal to confirm. Please create a new request.' });
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

    await intentManager.removeMemory(intentMemory.id);

    // Simple transfer
    // @ts-ignore
    if (intent?.type === 'TRANSFER') {
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

    // Excecute proposal via wallet provider
    const provider = await getWalletProvider(wallet)
    let links = ''

    try {
        // @ts-ignore
      const transactions = proposal.transactions || []
        // @ts-ignore
      if (proposal.transaction)
        // @ts-ignore
        transactions.push(proposal.transaction)

      let i = 0
      for (let transaction of transactions) {
        // tx = await provider.sendTransaction(proposal.transaction);
        // TMP: Default agent SDK fails with `provider.sendTransaction`
        const tx = await sendTransaction(provider, transaction, true);

        // @ts-ignore
        links += `- ${proposal.titles[i]}: ${tx.transactionLink}\n`
        i += 1
      }

      // @ts-ignore
      callback({ text: `Transactions completed! \n${links}` });
      return false
    } catch (error) {
      console.log(error)
      elizaLogger.error('Error sending transactions:', error);
      if (links.length > 0) {
        callback({ text: 'Sorry, a few transactions succeeded but not all of them. Confirmed transactions: \n' + links });
      } else {
        callback({ text: 'Sorry, there was an error creating the transaction. Please try again.' });
      }

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
          text: 'Sending your proposal...',
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
