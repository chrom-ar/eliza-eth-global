import { Plugin } from '@elizaos/core';
import { createWalletAction } from './actions/createWalletAction';
import { parseTransferAction } from './actions/parseTransferAction';
import { confirmIntentAction } from './actions/confirmIntentAction';
import { getBalanceAction } from './actions/getBalanceAction';
import { parseYieldAction } from './actions/parseYieldAction';
import { SolverService } from './services/solver';


export const chromaPlugin: Plugin = {
  name: 'plugin-chroma',
  description: 'Converts user queries to structured intents and broadcasts them',
  actions: [createWalletAction, parseTransferAction, confirmIntentAction, getBalanceAction, parseYieldAction],
  services: [new SolverService()]
};
