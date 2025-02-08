import { Action, Memory, IAgentRuntime, HandlerCallback, State, ModelClass, composeContext, generateObject, MemoryManager, elizaLogger } from '@elizaos/core';
import { z } from 'zod';

// Define the schema for transfer intent
const transferSchema = z.object({
  amount: z.string(),
  token: z.string(),
  // fromAddress: z.string(),
  toAddress: z.string(),
  chain: z.string().default('base-sepolia'),
});

const contextTemplate = `# Recent Messages
{{recentMessages}}

# Providers data
{{providers}}

Extract transfer intent information from the message and build an EVM transfer transaction.
If it's an ETH transfer use native transfer, if not, use the ERC20 transfer method.
When no from address or chain is directly specified, use the user's wallet data provided in the context.
If no to address is specified, suggest the user to create one.
If no chain is specified, use "base-sepolia" as the default.`;

export const parseTransferAction: Action = {
  name: 'PARSE_TRANSFER_INTENT',
  similes: ['TRANSFER_INTENT', 'SEND_INTENT'],
  description: 'Parses user query and constructs a GaslessCrossChainIntent JSON for a transfer',

  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const text = message.content.text.toLowerCase();

    return text.includes('transfer') ||
           text.includes('send') ||
           ((text.includes('to') || text.includes('address')) && /eth|usdc|usdt/i.test(text));
  },

  handler: async (runtime: IAgentRuntime, message: Memory, state: State | undefined, _options: { [key: string]: unknown; }, callback: HandlerCallback): Promise<boolean> => {
    console.log("Entro al parseTransfer")
    const context = composeContext({
      state: state,
      template: contextTemplate
    });

    // Extract transfer info using schema validation
    const intentData = (await generateObject({
      runtime,
      modelClass: ModelClass.SMALL,
      schema: transferSchema,
      schemaName: 'TransferIntent',
      context
    })).object as z.infer<typeof transferSchema>;
    console.log('intentData', intentData)

    if (Object.keys(intentData).length === 0) {
      callback(message.content);
      return true;
    }

    const { amount, token, toAddress, chain } = intentData;
    const responseText = toAddress
      ? `I've created a transfer intent for ${amount} ${token} to ${toAddress} on ${chain}. Would you like to confirm this transfer? \n ${JSON.stringify(intentData, null, 2)}`
      : `I've started creating a transfer intent for ${amount} ${token}. Please provide a recipient address to continue.`;

    const intentManager = new MemoryManager({
      runtime,
      tableName: 'intents'
    });

    await intentManager.removeAllMemories(message.roomId);

    const newMemory: Memory = await intentManager.addEmbeddingToMemory({
      userId: message.userId,
      agentId: message.agentId,
      roomId: message.roomId,
      createdAt: Date.now(),
      unique: true,
      content: {
        text: responseText,
        action: 'PARSE_TRANSFER_INTENT',
        source: message.content?.source,
        intent: {
          ...intentData,
          status: 'pending',
          type: 'TRANSFER'
        }
      }
    });

    await intentManager.createMemory(newMemory);
    callback(newMemory.content);

    elizaLogger.info('Transfer intent created', intentData);

    return true;
  },

  examples: [
    [
      {
        user: '{{user1}}',
        content: { text: 'Transfer 1 ETH to 0x1234...5678' }
      },
      {
        user: '{{user2}}',
        content: {
          text: 'Building your transfer intent...',
          action: 'PARSE_TRANSFER_INTENT'
        }
      }
    ],
    [
      {
        user: '{{user1}}',
        content: { text: 'Send 100 USDC to my friend on Solana' }
      },
      {
        user: '{{user2}}',
        content: {
          text: 'Building your transfer intent...',
          action: 'PARSE_TRANSFER_INTENT'
        }
      }
    ],
    [
      {
        user: '{{user1}}',
        content: { text: 'Hey {{user2}}, how do I send crypto?' }
      },
      {
        user: '{{user2}}',
        content: {
          text: 'I can help you transfer crypto. Just let me know how much and what token you want to send, and to which address.'
        }
      }
    ]
  ]
};
