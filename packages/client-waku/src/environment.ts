import { z, ZodError } from 'zod';
import { IAgentRuntime, parseBooleanFromText } from '@elizaos/core';

/**
 * The user must provide:
 *   - WAKU_CONTENT_TOPIC (string, no default)
 *   - WAKU_TOPIC (string, no default)
 *   - WAKU_PING_COUNT (int, default 20)
 */
const wakuEnvSchema = z.object({
  WAKU_CONTENT_TOPIC: z
    .string()
    .min(1, 'WAKU_CONTENT_TOPIC is required'),
  WAKU_TOPIC: z
    .string()
    .min(1, 'WAKU_TOPIC is required'),
  WAKU_PING_COUNT: z
    .number()
    .int()
    .default(20),
  WAKU_STATIC_PEERS: z
    .string()
    .trim(),
});

export type WakuConfig = z.infer<typeof wakuEnvSchema>;

export async function validateWakuConfig(
  runtime: IAgentRuntime
): Promise<WakuConfig> {
  try {
    const wakuConfig = {
      WAKU_CONTENT_TOPIC: runtime.getSetting('WAKU_CONTENT_TOPIC'),
      WAKU_TOPIC: runtime.getSetting('WAKU_TOPIC'),
      WAKU_PING_COUNT: parseInt(runtime.getSetting('WAKU_PING_COUNT')) || 20,
      WAKU_STATIC_PEERS: runtime.getSetting('WAKU_STATIC_PEERS'),
    };

    return wakuEnvSchema.parse(wakuConfig);
  } catch (error) {
    if (error instanceof ZodError) {
      const errorMessages = error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join('\n');
      throw new Error(`Waku configuration validation failed:\n${errorMessages}`);
    }
    throw error;
  }
}
