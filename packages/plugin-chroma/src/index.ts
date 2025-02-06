import { Plugin } from '@elizaos/core';
import { SolverService } from './services/solver';
import { createWalletAction } from './actions/createWalletAction';

export const chromaPlugin: Plugin = {
  name: 'plugin-chroma',
  description: 'Converts user queries to structured intents and broadcasts them',
  actions: [createWalletAction],
  services: [new SolverService()]
};
