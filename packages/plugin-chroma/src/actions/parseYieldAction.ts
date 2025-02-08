import { Action, Memory, IAgentRuntime, HandlerCallback, State, ModelClass, composeContext, generateObject, MemoryManager, elizaLogger } from '@elizaos/core';
import { z } from 'zod';
import { WakuClientInterface } from '@elizaos/client-waku';

// Define the schema for transfer intent
const yieldSchema = z.object({
  type: z.literal('YIELD'),
  amount: z.string(),
  fromToken: z.string(),
  recipientAddress: z.string(),
  fromChain: z.string().default('base-sepolia'),
});

const contextTemplate = `# Recent Messages
{{recentMessages}}

# Providers data
{{providers}}

Extract yield intent information from the message.
If no chain is specified, use "base-sepolia" as the default.`;

export const parseYieldAction: Action = {
  name: 'PARSE_YIELD_INTENT',
  similes: ['YIELD_INTENT'],
  description: 'Parses user query and constructs a yield intent',

  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const text = message.content.text.toLowerCase();

    return text.includes('yield') ||
    text.includes('deposit') ||
    text.includes('invest') ||
    ((text.includes('to') || text.includes('address')) && /eth|usdc|usdt/i.test(text));
  },

  handler: async (runtime: IAgentRuntime, message: Memory, state: State | undefined, _options: { [key: string]: unknown; }, callback: HandlerCallback): Promise<boolean> => {
    console.log("Entro al parseYield")
    const context = composeContext({
      state: state,
      template: contextTemplate
    });

    // Extract transfer info using schema validation
    const intentData = (await generateObject({
      runtime,
      modelClass: ModelClass.SMALL,
      schema: yieldSchema,
      schemaName: 'YieldIntent',
      context
    })).object as z.infer<typeof yieldSchema>;
    console.log('intentData', intentData)

    if (Object.keys(intentData).length === 0) {
      callback(message.content);
      return true;
    }

    const walletManager = new MemoryManager({
      runtime,
      tableName: 'wallets'
    });

    // Check if user already has a wallet
    // @ts-ignore
    const [existingWallet] = await walletManager.getMemories({ roomId: message.roomId, count: 1 });

    if (!existingWallet) {
      callback({ text: 'We need a wallet to continue. Do you want me to create a wallet?' });
      return false;
    }
    // @ts-ignore
    intentData.recipientAddress = existingWallet.content.address.id; // model kinda sucks putting the wallet

    const { amount, fromToken, fromChain, recipientAddress } = intentData;
    const responseText = `I've created a yield intent for ${amount} ${fromToken} to ${recipientAddress} on ${fromChain}. \n\n Broadcasted the intent to receive the best quotas.\n\n`

    await callback({ text: responseText }); // this doesn't work (?)

    const intentManager = new MemoryManager({
      runtime,
      tableName: 'intents'
    });

    await intentManager.removeAllMemories(message.roomId);

    const waku = runtime.clients?.waku || await WakuClientInterface.start(runtime)
    await waku.sendMessage(
      intentData,
      '', // General intent topic
      message.roomId
    );

    console.log("Sent message to waku")

    // TMP: This shit shouldn't be like this, workaround to make the chat refresh work
    await new Promise<void>((resolve) => {
      waku.subscribe(
        message.roomId,
        async (receivedMessage) => {

          try {
            // console.log("Received msj in subscription:", receivedMessage)
            // console.log('Received a message in room', message.roomId, receivedMessage.body);
            let memoryText = `${responseText}\n Best proposal: ${receivedMessage.body.proposal.description}.\nActions:\n`
            const calls = receivedMessage.body.proposal.calls
            for (let index in calls) {
              memoryText += `- ${parseInt(index) + 1}: ${calls[index]}\n` // JS always surprising you
            }
            memoryText += `\nDo you want to confirm?`

            // Create a response memory
            const responseMemory: Memory = await runtime.messageManager.addEmbeddingToMemory({
              userId: message.userId,
              agentId: message.agentId,
              roomId: message.roomId,
              content: {
                text: memoryText,
                action: 'YIELD_PROPOSAL',
                source: receivedMessage.body.source,
                proposal: receivedMessage.body.proposal
              },
              createdAt: Date.now()
            });

            await runtime.messageManager.createMemory(responseMemory);

            // Use callback to ensure the message appears in chat
            await callback(responseMemory.content)

            // Update state and process any actions if needed
            const state = await runtime.updateRecentMessageState(
              await runtime.composeState(responseMemory)
            );

            await runtime.evaluate(responseMemory, state, false, callback);

            // Persist the proposal
            const intentManager = new MemoryManager({
              runtime,
              tableName: 'intents'
            });

            const newMemory: Memory = await intentManager.addEmbeddingToMemory({
              userId: message.userId,
              agentId: message.agentId,
              roomId: message.roomId,
              createdAt: Date.now(),
              unique: true,
              content: {
                text: responseText,
                action: 'YIELD_PROPOSAL',
                source: message.content?.source,
                proposal: receivedMessage.body.proposal
              }
            });

            await intentManager.createMemory(newMemory);

            // callback(newMemory.content);

          } catch (e) {
            console.error("Error inside subscription:", e)
          }

          resolve()
        }
      )
    })

    // elizaLogger.info('Yield intent created', intentData);
    return true;
  },

  examples: [
    [
      {
        user: '{{user1}}',
        content: { text: 'I want a yield interest strategy with 1 ETH' }
      },
      {
        user: '{{user2}}',
        content: {
          text: 'Building your yield intent...',
          action: 'PARSE_YIELD_INTENT'
        }
      }
    ],
    [
      {
        user: '{{user1}}',
        content: { text: 'I want an interest strategy with 100 USDC' }
      },
      {
        user: '{{user2}}',
        content: {
          text: 'Building your yield intent...',
          action: 'PARSE_YIELD_INTENT'
        }
      }
    ],
    [
      {
        user: '{{user1}}',
        content: { text: 'Hey {{user2}}, how do I invest in crypto?' }
      },
      {
        user: '{{user2}}',
        content: {
          text: 'I can help you to deposit in a yield strategy. Just let me know how much and what token you want to deposit.'
        }
      }
    ]
  ]
};
