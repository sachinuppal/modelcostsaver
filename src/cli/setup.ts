/**
 * First-run setup helper (spec Section 10).
 *
 * ModelCostSaver needs no auth and no keys, which is the differentiator; setup
 * just confirms the install story and points at the install subcommand for every
 * supported client. All output goes to stderr (stdout is the JSON-RPC channel).
 */

import { CLIENTS } from './install.js';
import { log } from '../server/log.js';

export async function runSetup(): Promise<void> {
  log.info('ModelCostSaver needs no API keys and makes no network calls for its core tools.');
  log.info('Install into a client with: modelcostsaver install --client <name>');
  log.info(`Supported clients: ${Object.keys(CLIENTS).join(', ')}`);
  log.info('Claude Code also supports: claude mcp add modelcostsaver -- npx -y @workswarm/modelcostsaver');
  log.info('After installing, restart the client, then call select_optimal_model before any non-trivial LLM call.');
}
