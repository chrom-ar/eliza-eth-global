import { Action, Memory, IAgentRuntime, HandlerCallback, State, MemoryManager } from '@elizaos/core';
import { elizaLogger } from '@elizaos/core';

import { getWalletAndProvider, createWallet } from '../utils';

const contextTemplate = `# Recent Messages
{{recentMessages}}

# Providers data
{{providers}}

Check if the user is requesting to create or access their wallet.`;


export const createWalletAction: Action = {
  name: 'CREATE_WALLET',
  similes: ['INITIALIZE_WALLET', 'SETUP_WALLET', 'GET_WALLET'],
  description: 'Creates or retrieves a CDP wallet for the user',

  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const text = message.content.text.toLowerCase();
    return text.includes('wallet') || text.includes('create') || text.includes('setup') ||
      text.includes('yes');
  },

  handler: async (runtime: IAgentRuntime, message: Memory, state: State, _options: { [key: string]: unknown; }, callback: HandlerCallback): Promise<boolean> => {
    try {
      // Initialize memory manager for wallets
      const walletManager = new MemoryManager({
        runtime,
        tableName: 'wallets'
      });

      // Check if user already has a wallet
      // @ts-ignore
      const [existingWallet] = await walletManager.getMemories({ roomId: message.roomId, count: 1 });

      let wallet;
      if (existingWallet) {
        // Wallet exists, try to import it
        try {
          [wallet] = await getWalletAndProvider(runtime, existingWallet.content.walletId as string);

          const walletAddress = (await wallet.getDefaultAddress()).id;
          callback({
            text: `Found your existing wallet with address: ${walletAddress}`,
            walletAddress,
            walletId: existingWallet.content.walletId
          });

          return true;
        } catch (error) {
          console.log(error)
          elizaLogger.error('Error importing existing wallet:', error);

          callback({
            text: `Error importing existing wallet: ${error}`,
          });

          return true;
        }
      }

      // Create new wallet
      wallet = await createWallet(runtime);
      const walletId = wallet.getId();
      const walletAddress = (await wallet.getDefaultAddress()).id;
      const networkId = wallet.getNetworkId()

      try {
        // Fund the wallet TMP only testnet
        await (await wallet.faucet()).wait();
      } catch (error) {
      }

      // Store wallet data in memory
      const newMemory: Memory = await walletManager.addEmbeddingToMemory({
        userId: message.userId,
        agentId: message.agentId,
        roomId: message.roomId,
        createdAt: Date.now(),
        unique: true,
        content: {
          text: `Successfully created a new wallet!\nAddress: ${walletAddress}\nNetwork: ${networkId}`,
          walletId: walletId,
          address: walletAddress,
          network: networkId
        }
      });

      await walletManager.createMemory(newMemory);

      callback({
        text: `Successfully created a new wallet!\nAddress: ${walletAddress}\nNetwork: ${networkId}`,
        walletAddress,
        walletId
      });

      return true;
    } catch (error) {
      console.log(error)
      elizaLogger.error('Error in createWalletAction:', error);
      callback({
        text: `Failed to create wallet: ${error.message}`,
        error: error.message
      });
      return false;
    }
  },

  examples: [
    [
      {
        user: '{{user1}}',
        content: { text: 'Create a wallet for me' }
      },
      {
        user: '{{user2}}',
        content: {
          text: 'Creating your wallet...',
          action: 'CREATE_WALLET'
        }
      }
    ],
    [
      {
        user: '{{user1}}',
        content: { text: 'Setup my wallet' }
      },
      {
        user: '{{user2}}',
        content: {
          text: 'Setting up your wallet...',
          action: 'CREATE_WALLET'
        }
      }
    ]
  ]
};
