import { Action, Memory, IAgentRuntime, HandlerCallback, State, MemoryManager } from '@elizaos/core';
import { elizaLogger } from '@elizaos/core';

import { getWalletAndProvider, getBalanceFor } from '../utils';

// For showcase purposes
const EXTRA_BALANCES = {
  "base-sepolia":{
    ["Aave-USDC"]: "0xf53b60f4006cab2b3c4688ce41fd5362427a2a66"
  }
}

export const getBalanceAction: Action = {
  name: 'GET_BALANCE',
  similes: [
    'CHECK_BALANCE',
    'VIEW_BALANCE',
    'SHOW_BALANCE',
    'CHECK_BALANCES',
    'VIEW_BALANCES',
    'SHOW_BALANCES',
    "GET_WALLET",
    "SHOW_WALLET"
  ],
  description: 'Gets ETH and USDC balance for the user\'s CDP wallet',

  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const text = message.content.text.toLowerCase();
    return text.includes('balance') || text.includes('check') ||
           text.includes('balances') || text.includes('amount') ||
           text.includes('money') ||
           text.includes('how much') || text.includes('funds') ||
           (text.includes('wallet') && text.includes('show'));
  },

  handler: async (runtime: IAgentRuntime, message: Memory, _state: State, _options: { [key: string]: unknown; }, callback: HandlerCallback): Promise<boolean> => {
    try {

      // Initialize memory manager for wallets
      const walletManager = new MemoryManager({
        runtime,
        tableName: 'wallets'
      });

      // Get user's wallet from memory
      // @ts-ignore
      const [existingWallet] = await walletManager.getMemories({ roomId: message.roomId, count: 1 });

      if (!existingWallet) {
        callback({
          text: "You don't have a wallet yet. Would you like me to create a new wallet for you?",
          needsWallet: true
        });
        return true;
      }

      // Fetch the wallet
      const [wallet, provider] = await getWalletAndProvider(runtime, existingWallet.content.walletId);
      // @ts-ignore
      const walletAddress = (await wallet.getDefaultAddress()).id;
      const balances = await wallet.listBalances();


      // Format response
      let balanceText = `Wallet Address: ${walletAddress}\n`
      for (const [k, v] of balances) {
        balanceText += `- ${v} ${k.toUpperCase()}\n`;
      }

      for (const [k, v] of Object.entries(EXTRA_BALANCES[wallet.getNetworkId()])) {
        const balance = await getBalanceFor(provider, v, true);

        if (balance && parseFloat(balance) > 0) {
          balanceText += `- ${balance} ${k}\n`;
        }
      }

      callback({ text: balanceText });

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
