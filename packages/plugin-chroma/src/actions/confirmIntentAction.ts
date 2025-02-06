import { Action, Memory, IAgentRuntime, MemoryManager, State, HandlerCallback, elizaLogger } from '@elizaos/core';
import { Coinbase, Wallet } from '@coinbase/coinbase-sdk';

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

    Coinbase.configure({
      apiKeyName:      runtime.getSetting("CHROMA_CDP_API_KEY_NAME"),
      privateKey:      runtime.getSetting("CHROMA_CDP_API_KEY_PRIVATE_KEY"),
      useServerSigner: true // By default we'll use the server signer
    });

    // Initialize memory manager for wallets
    const walletManager = new MemoryManager({
      runtime,
      tableName: 'wallets'
    });

    // Check if user already has a wallet
    // @ts-ignore
    const existingWallets = await walletManager.getMemories({ roomId: message.roomId, count: 1 });
    const existingWallet = existingWallets.find(m => m.content?.walletId);

    if (!existingWallet) {
      callback({ text: 'Sorry, We need a wallet to continue. Do you want me to create a wallet?' });
      return false;
    }


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

    try {
      const tx = await wallet.createTransfer({
        assetId:     intent.token.toLowerCase(),
        destination: intent.toAddress,
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
