/**
 * list_models / get_pricing (spec 6.5): return the catalog, optionally filtered
 * by provider, tier, capability, or a max input price. capabilities Sets are
 * serialized to arrays. Includes catalogVersion and asOf. Read-only, offline.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MODEL_CATALOG } from '../catalog/model-catalog';
import { serializeModel } from '../catalog/serialize';
import type { ModelCapability, ModelTier, ProviderName } from '../catalog/types';
import type { ToolContext } from '../server/context.js';
import { ok, providerEnum, type ToolResult } from './shared.js';

const inputSchema = {
  provider: providerEnum.optional().describe('Filter to a single provider.'),
  tier: z.enum(['trivial', 'fast', 'standard', 'reasoning']).optional().describe('Filter to a single tier.'),
  capability: z.enum(['chat', 'tools', 'vision', 'streaming']).optional().describe('Require a capability.'),
  maxInputPerMillion: z.number().nonnegative().optional().describe('Only models at or below this input price per 1M tokens.'),
  includeLocal: z.boolean().optional().describe('Include local / self-hosted $0 models (off by default).'),
};

const modelShape = z.object({
  id: z.string(),
  alias: z.string(),
  provider: z.string(),
  tier: z.string(),
  capabilities: z.array(z.string()),
  inputPerMillion: z.number(),
  outputPerMillion: z.number(),
  outputCap: z.number().optional(),
  license: z.string().optional(),
});

const outputSchema = {
  models: z.array(modelShape),
  count: z.number(),
  catalogVersion: z.string(),
  asOf: z.string(),
  source: z.string(),
};

type ListArgs = {
  provider?: ProviderName;
  tier?: ModelTier;
  capability?: ModelCapability;
  maxInputPerMillion?: number;
  includeLocal?: boolean;
};

function handler(context: ToolContext, args: ListArgs): ToolResult {
  const includeLocal = args.includeLocal ?? context.config.includeLocal;
  const models = Object.values(MODEL_CATALOG)
    .filter((m) => includeLocal || m.provider !== 'local')
    .filter((m) => (args.provider ? m.provider === args.provider : true))
    .filter((m) => (args.tier ? m.tier === args.tier : true))
    .filter((m) => (args.capability ? m.capabilities.has(args.capability) : true))
    .filter((m) => (typeof args.maxInputPerMillion === 'number' ? m.pricing.inputPerMillion <= args.maxInputPerMillion : true))
    .map(serializeModel)
    .sort((a, b) => a.inputPerMillion - b.inputPerMillion);

  const structured = {
    models,
    count: models.length,
    catalogVersion: context.catalogMeta.catalogVersion,
    asOf: context.catalogMeta.asOf,
    source: context.catalogMeta.source,
  };

  const text =
    `${models.length} model(s) in catalog ${context.catalogMeta.catalogVersion} (as of ${context.catalogMeta.asOf}).` +
    (models.length > 0 ? ` Cheapest input: ${models[0].id} at $${models[0].inputPerMillion}/1M.` : '');

  return ok(text, structured);
}

export function registerListModelsTool(server: McpServer, context: ToolContext): void {
  const config = {
    title: 'List models / pricing',
    description: 'Return the model catalog with pricing, optionally filtered. capabilities are arrays. Offline.',
    inputSchema,
    outputSchema,
  };
  server.registerTool('list_models', config, (args: ListArgs) => handler(context, args));
  /* get_pricing is the same data under the name agents reach for when asking
     "what does X cost"; register both so either discovers the catalog. */
  server.registerTool('get_pricing', config, (args: ListArgs) => handler(context, args));
}
