/**
 * Register all ModelCostSaver tools on the server.
 *
 * The seven core tools are always present (list_models is also registered under
 * get_pricing). record_usage is opt-in and only registered when the ledger is
 * enabled (MODELCOSTSAVER_LEDGER=on), so its absence is the honest signal that
 * nothing is being written.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from '../server/context.js';
import { registerEstimateCostTool } from './estimate-cost.js';
import { registerPredictCostTool } from './predict-cost.js';
import { registerSelectOptimalModelTool } from './select-optimal-model.js';
import { registerCompareModelsTool } from './compare-models.js';
import { registerListModelsTool } from './list-models.js';
import { registerOptimizeRequestTool } from './optimize-request.js';
import { registerRecordUsageTool } from './record-usage.js';

export function registerTools(server: McpServer, context: ToolContext): void {
  registerEstimateCostTool(server, context);
  registerPredictCostTool(server, context);
  registerSelectOptimalModelTool(server, context);
  registerCompareModelsTool(server, context);
  registerListModelsTool(server, context);
  registerOptimizeRequestTool(server, context);
  registerRecordUsageTool(server, context);
}
