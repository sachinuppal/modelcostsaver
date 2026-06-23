/**
 * MCP prompts (spec 6.8): discoverable cost-discipline guidance an agent can
 * pull into context. MCP cannot make a server auto-invoke a tool, so these
 * prompts are the mechanism for biasing an agent toward forecasting cost and
 * picking the cheapest sufficient model.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const USAGE_PROMPT = [
  'Be cost-disciplined with LLM calls. Before any non-trivial call:',
  '1. Call select_optimal_model with the task and an estimated token shape. Use',
  '   the cheapest model it returns that meets the task tier and capabilities.',
  '2. To forecast across candidates, call predict_cost with the prompt.',
  '3. To sanity check a habitual choice (for example always using Opus), call',
  '   optimize_request with the model you planned to use and act on the savings.',
  'Prefer the cheapest tier that satisfies the task; do not reach for a reasoning',
  'model for classification or summarization. If a call fails with a rate-limit,',
  'quota, or 5xx error, retry on the next model in the returned fallbackChain.',
  'Costs are USD plus an integer usdMicros; a fractional-cent call is still real.',
].join('\n');

const SETUP_PROMPT = [
  'ModelCostSaver is an offline MCP server that predicts LLM cost and recommends the',
  'cheapest capable model. It needs no API keys and makes no network calls for',
  'its core tools.',
  '',
  'To use it:',
  '- Confirm the modelcostsaver server is connected (its tools should appear in your',
  '  tool list: estimate_cost, predict_cost, select_optimal_model, compare_models,',
  '  list_models, get_pricing, optimize_request).',
  '- If it is not connected, run "modelcostsaver install" to print the IDE config block,',
  '  add it to your client, and restart the client.',
  '- Then, before non-trivial LLM calls, call select_optimal_model first.',
].join('\n');

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'modelcostsaver',
    {
      title: 'ModelCostSaver usage',
      description:
        'How and when to use ModelCostSaver: forecast cost and pick the cheapest capable model before an LLM call.',
    },
    () => ({
      messages: [{ role: 'user', content: { type: 'text', text: USAGE_PROMPT } }],
    }),
  );

  server.registerPrompt(
    'modelcostsaver-setup',
    {
      title: 'ModelCostSaver setup',
      description: 'Self-configure ModelCostSaver in this client. Hand this to your agent to set it up.',
    },
    () => ({
      messages: [{ role: 'user', content: { type: 'text', text: SETUP_PROMPT } }],
    }),
  );
}
