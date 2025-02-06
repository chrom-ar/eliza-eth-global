import { Action, Memory, IAgentRuntime, HandlerCallback, State, MemoryManager } from '@elizaos/core';
import { Coinbase, Wallet } from '@coinbase/coinbase-sdk';
import { elizaLogger } from '@elizaos/core';

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

      if (existingWallet) {
        // Wallet exists, try to import it
        try {
          const wallet = await Wallet.fetch(existingWallet.content.walletId as string);

          const walletAddress = await wallet.getDefaultAddress();
          callback({
            text: `Found your existing wallet with address: ${walletAddress}`,
            walletAddress,
            walletId: existingWallet.content.walletId
          });

          return true;
        } catch (error) {
          console.log(error)
          elizaLogger.error('Error importing existing wallet:', error);
          // If import fails, continue to create new wallet
        }
      }

      // Create new wallet
      const networkId = runtime.getSetting("CDP_NETWORK_ID") || "base-sepolia";
      const wallet = await Wallet.create({ networkId });
      const walletId = wallet.getId();
      const walletAddress = await wallet.getDefaultAddress();

      // Fund the wallet TMP only testnet
      await (await wallet.faucet()).wait();

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
