import { Action, Memory, IAgentRuntime, HandlerCallback, State, MemoryManager } from '@elizaos/core';
import { Coinbase, Wallet } from '@coinbase/coinbase-sdk';
import { elizaLogger } from '@elizaos/core';

export const getBalanceAction: Action = {
  name: 'GET_BALANCE',
  similes: ['CHECK_BALANCE', 'VIEW_BALANCE', 'SHOW_BALANCE', "GET_WALLET", "SHOW_WALLET"],
  description: 'Gets ETH and USDC balance for the user\'s CDP wallet',

  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const text = message.content.text.toLowerCase();
    return text.includes('balance') || text.includes('check') || 
           text.includes('how much') || text.includes('funds') || 
           (text.includes('wallet') && text.includes('show'));
  },

  handler: async (runtime: IAgentRuntime, message: Memory, _state: State, _options: { [key: string]: unknown; }, callback: HandlerCallback): Promise<boolean> => {
    try {
      // Configure Coinbase SDK
      Coinbase.configure({
        apiKeyName: runtime.getSetting("CHROMA_CDP_API_KEY_NAME"),
        privateKey: runtime.getSetting("CHROMA_CDP_API_KEY_PRIVATE_KEY"),
        useServerSigner: true
      });

      // Initialize memory manager for wallets
      const walletManager = new MemoryManager({
        runtime,
        tableName: 'wallets'
      });

      // Get user's wallet from memory
      // @ts-ignore
      const existingWallets = await walletManager.getMemories({ roomId: message.roomId, count: 1 });
      const existingWallet = existingWallets.find(m => m.content?.walletId);

      if (!existingWallet) {
        callback({
          text: "You don't have a wallet yet. Would you like me to create a new wallet for you?",
          needsWallet: true
        });
        return true;
      }

      // Fetch the wallet
      const wallet = await Wallet.fetch(existingWallet.content.walletId as string);
      const walletAddress = (await wallet.getDefaultAddress()).id;

      // Get ETH balance
      const ethBalance = await wallet.getBalance(Coinbase.assets.Eth);
      // const formattedEthBalance = Number(ethBalance) / 1e18; // Convert from wei to ETH

      // Get USDC balance
      const usdcBalance = await wallet.getBalance(Coinbase.assets.Usdc);
      // const formattedUsdcBalance = Number(usdcBalance) / 1e6; // Convert from smallest unit to USDC

      // Format response
      const balanceText = `Wallet Address: ${walletAddress}\n` +
                         `ETH Balance: ${ethBalance} ETH\n` +
                         `USDC Balance: ${usdcBalance} USDC`;

      callback({
        text: balanceText,
        content: {
          address: walletAddress,
          ethBalance: ethBalance,
          usdcBalance: usdcBalance,
          network: existingWallet.content.network
        }
      });

      return true;
    } catch (error) {
      console.error(error);
      elizaLogger.error('Error in getBalanceAction:', error);
      callback({
        text: `Failed to get wallet balance: ${error.message}`,
        error: error.message
      });
      return false;
    }
  },

  examples: [
    [
      {
        user: '{{user1}}',
        content: { text: 'What\'s my balance?' }
      },
      {
        user: '{{user2}}',
        content: {
          text: 'Checking your wallet balance...',
          action: 'GET_BALANCE'
        }
      }
    ],
    [
      {
        user: '{{user1}}',
        content: { text: 'How much ETH do I have?' }
      },
      {
        user: '{{user2}}',
        content: {
          text: 'Let me check your balances...',
          action: 'GET_BALANCE'
        }
      }
    ]
  ]
}; 