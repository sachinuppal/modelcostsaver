/**
 * compare_models (spec 6.4): side-by-side cost table for a fixed token shape,
 * cheapest-first, with each row's multiple of the cheapest and cheapest /
 * mostCapable callouts. Applies the spec 5.4 availability scope. Read-only.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { compareModels, type CompareRow } from '../optimizer/compare';
import type { ProviderName } from '../catalog/types';
import type { ToolContext } from '../server/context.js';
import { ok, fail, fmtUsd, providerEnum, targetEnum, resolveScope, type ToolResult } from './shared.js';

const inputSchema = {
  models: z.array(z.string()).min(1).max(50).describe('Models to compare (alias or id).'),
  inputTokens: z.number().int().nonnegative().describe('Input tokens for the comparison.'),
  outputTokens: z.number().int().nonnegative().describe('Output tokens for the comparison.'),
  providers: z.array(providerEnum).optional().describe('Axis 1: provider availability allowlist (spec 5.4).'),
  target: targetEnum.optional().describe('Axis 2: "self" (default) applies the client scope; "code" considers all providers.'),
};

const rowShape = z.object({
  model: z.string(),
  provider: z.string(),
  tier: z.string(),
  capabilities: z.array(z.string()),
  cost: z.object({ usd: z.number(), usdMicros: z.number() }),
  relativeToCheapest: z.string(),
});

const outputSchema = {
  rows: z.array(rowShape),
  cheapest: rowShape.nullable(),
  mostCapable: rowShape.nullable(),
  cheaperIfAvailable: z.object({ model: z.string(), provider: z.string(), cost: z.object({ usd: z.number(), usdMicros: z.number() }), reason: z.string() }).optional(),
  unknownModels: z.array(z.string()),
  providerScope: z.array(z.string()),
  scopeSource: z.string(),
  catalogVersion: z.string(),
  asOf: z.string(),
};

type CompareArgs = {
  models: string[];
  inputTokens: number;
  outputTokens: number;
  providers?: ProviderName[];
  target?: 'self' | 'code';
};

export function registerCompareModelsTool(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'compare_models',
    {
      title: 'Compare models',
      description:
        'Compare models side by side for a fixed token shape, cheapest first, with the multiple of the cheapest. Offline.',
      inputSchema,
      outputSchema,
    },
    (args: CompareArgs): ToolResult => {
      const result = compareModels({
        models: args.models,
        inputTokens: args.inputTokens,
        outputTokens: args.outputTokens,
      });

      if (result.rows.length === 0) {
        return fail(`No models resolved from: ${args.models.join(', ')}.`, 'unknown_model');
      }

      const { providerScope, scopeSource, applyScope } = resolveScope(
        context,
        args.providers,
        args.target ?? 'self',
      );

      const scopedRows = applyScope
        ? result.rows.filter((r) => providerScope.includes(r.provider as ProviderName))
        : result.rows;

      /* Recompute the cheapest within scope and the relative multiples against
         the in-scope cheapest so the table is internally consistent. */
      const rebased = rebaseRelative(scopedRows);
      const cheapest = rebased[0] ?? null;
      const mostCapable = pickMostCapable(rebased);
      const cheaperIfAvailable = computeCheaper(applyScope, providerScope, result.rows, cheapest);

      const structured = {
        rows: rebased,
        cheapest,
        mostCapable,
        ...(cheaperIfAvailable ? { cheaperIfAvailable } : {}),
        unknownModels: result.unknownModels,
        providerScope,
        scopeSource,
        catalogVersion: context.catalogMeta.catalogVersion,
        asOf: context.catalogMeta.asOf,
      };

      const text = cheapest
        ? `Cheapest: ${cheapest.model} (${fmtUsd(cheapest.cost.usd)}). ` +
          `Most capable: ${mostCapable?.model ?? 'n/a'}. ${rebased.length} model(s) compared.` +
          (cheaperIfAvailable ? ` Cheaper if available: ${cheaperIfAvailable.model}.` : '')
        : 'No models in the active scope.';

      return ok(text, structured);
    },
  );
}

/** Recompute relativeToCheapest against the cheapest of the given rows. */
function rebaseRelative(rows: CompareRow[]): CompareRow[] {
  if (rows.length === 0) return rows;
  const cheapestUsd = rows[0].cost.usd;
  return rows.map((r) => ({
    ...r,
    relativeToCheapest:
      cheapestUsd <= 0 ? (r.cost.usd <= 0 ? '1.0x' : 'n/a') : `${(r.cost.usd / cheapestUsd).toFixed(1)}x`,
  }));
}

function pickMostCapable(rows: CompareRow[]): CompareRow | null {
  if (rows.length === 0) return null;
  return [...rows].sort(
    (a, b) => b.capabilities.length - a.capabilities.length || b.cost.usd - a.cost.usd,
  )[0];
}

function computeCheaper(
  applyScope: boolean,
  scope: ProviderName[],
  allRows: CompareRow[],
  cheapestInScope: CompareRow | null,
): { model: string; provider: string; cost: { usd: number; usdMicros: number }; reason: string } | undefined {
  if (!applyScope || !cheapestInScope) return undefined;
  const outside = allRows
    .filter((r) => !scope.includes(r.provider as ProviderName))
    .sort((a, b) => a.cost.usd - b.cost.usd)[0];
  if (!outside || outside.cost.usd >= cheapestInScope.cost.usd) return undefined;
  const scoped = [...scope].sort().join(', ');
  return {
    model: outside.model,
    provider: outside.provider,
    cost: outside.cost,
    reason: `not available in this client (${scoped}-scoped); pass target=code if this is for an app you are building`,
  };
}
