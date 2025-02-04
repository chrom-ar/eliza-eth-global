import { Client, elizaLogger, IAgentRuntime } from '@elizaos/core';
import { validateWakuConfig, WakuConfig } from './environment';
import { WakuClient } from './client';

/**
 * Implement the main interface for the agent's plugin 'Client'.
 */
export const WakuClientInterface: Client = {
  async start(runtime: IAgentRuntime) {
    if (this.instance) {
      console.log("WAKU CON INSTANCE")
      return this.instance
    }
      console.log("WAKU SIN INSTANCE")
    const wakuConfig: WakuConfig = await validateWakuConfig(runtime);

    // Create manager & plugin
    const client = new WakuClient(wakuConfig);

    // Initialize client
    await client.init();

    elizaLogger.log('Waku client started');

    this.instance = client;

    return client;
  },

  async stop(_runtime: IAgentRuntime) {
    elizaLogger.warn('Waku client does not support stopping yet');
  },
};

export default WakuClientInterface;
