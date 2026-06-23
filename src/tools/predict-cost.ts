/**
 * predict_cost (spec 6.2): forecast the cost of a prompt across a candidate set
 * BEFORE the call. Applies the spec 5.4 availability scope for target=self and
 * surfaces a cheaperIfAvailable when the globally-cheapest forecast is outside
 * the actionable scope. Read-only, offline.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { predictCost, type ModelForecast } from '../optimizer/predict';
import type { ProviderName, TaskClass } from '../catalog/types';
import { TASK_CLASSES } from '../catalog/model-catalog';
import type { ToolContext } from '../server/context.js';
import { ok, fail, fmtUsd, providerEnum, targetEnum, resolveScope, type ToolResult } from './shared.js';

const inputSchema = {
  prompt: z.string().max(2_000_000).optional().describe('The prompt to forecast; estimated to tokens if inputTokens absent.'),
  inputTokens: z.number().int().nonnegative().optional().describe('Exact input tokens (skips prompt estimation).'),
  contextTokens: z.number().int().nonnegative().optional().describe('Known context tokens already loaded.'),
  candidates: z.array(z.string()).max(50).optional().describe('Candidate models (alias or id); defaults to all chat-capable.'),
  expectedOutputTokens: z.number().int().nonnegative().optional().describe('Exact output tokens; else inferred from taskClass/model.'),
  taskClass: z.enum(TASK_CLASSES as [TaskClass, ...TaskClass[]]).optional().describe('Drives the default output cap.'),
  providers: z.array(providerEnum).optional().describe('Axis 1: provider availability allowlist (spec 5.4).'),
  target: targetEnum.optional().describe('Axis 2: "self" (default) applies the client scope; "code" considers all providers.'),
  includeLocal: z.boolean().optional(),
  charsPerToken: z.number().positive().optional(),
};

const forecastShape = z.object({
  model: z.string(),
  provider: z.string(),
  tier: z.string(),
  predictedInputTokens: z.number(),
  predictedOutputTokens: z.number(),
  cost: z.object({ usd: z.number(), usdMicros: z.number() }),
  assumptions: z.array(z.string()),
});

const outputSchema = {
  forecasts: z.array(forecastShape),
  cheapest: forecastShape.nullable(),
  cheaperIfAvailable: z
    .object({ model: z.string(), provider: z.string(), cost: z.object({ usd: z.number(), usdMicros: z.number() }), reason: z.string() })
    .optional(),
  providerScope: z.array(z.string()),
  scopeSource: z.string(),
  notes: z.array(z.string()),
  catalogVersion: z.string(),
  asOf: z.string(),
};

type PredictArgs = {
  prompt?: string;
  inputTokens?: number;
  contextTokens?: number;
  candidates?: string[];
  expectedOutputTokens?: number;
  taskClass?: TaskClass;
  providers?: ProviderName[];
  target?: 'self' | 'code';
  includeLocal?: boolean;
  charsPerToken?: number;
};

export function registerPredictCostTool(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'predict_cost',
    {
      title: 'Predict cost',
      description:
        'Forecast the cost of a prompt across candidate models before the call. Returns a cheapest-first ranking with assumptions. Offline.',
      inputSchema,
      outputSchema,
    },
    (args: PredictArgs): ToolResult => {
      if (typeof args.prompt !== 'string' && typeof args.inputTokens !== 'number') {
        return fail('Provide prompt or inputTokens.', 'missing_input');
      }

      const { providerScope, scopeSource, applyScope } = resolveScope(
        context,
        args.providers,
        args.target ?? 'self',
      );

      const result = predictCost({
        prompt: args.prompt,
        inputTokens: args.inputTokens,
        contextTokens: args.contextTokens,
        candidates: args.candidates,
        expectedOutputTokens: args.expectedOutputTokens,
        taskClass: args.taskClass,
        includeLocal: args.includeLocal ?? context.config.includeLocal,
        charsPerToken: args.charsPerToken ?? context.config.charsPerToken,
      });

      /* Apply Axis-1 scope (for target=self, or an explicit providers arg). The
         pre-scope forecasts remain available to surface cheaperIfAvailable. */
      const scoped = applyScope
        ? result.forecasts.filter((f) => providerScope.includes(f.provider as ProviderName))
        : result.forecasts;

      const cheapest = scoped[0] ?? null;
      const cheaperIfAvailable = computeCheaper(applyScope, providerScope, result.forecasts, cheapest);

      const notes = [...result.notes];
      if (applyScope) {
        notes.push(`Scoped to providers: ${[...providerScope].sort().join(', ')} (${scopeSource}).`);
      } else {
        notes.push('All providers eligible (target=code).');
      }

      const structured = {
        forecasts: scoped,
        cheapest,
        ...(cheaperIfAvailable ? { cheaperIfAvailable } : {}),
        providerScope,
        scopeSource,
        notes,
        catalogVersion: context.catalogMeta.catalogVersion,
        asOf: context.catalogMeta.asOf,
      };

      const text = cheapest
        ? `Cheapest: ${cheapest.model} at ${fmtUsd(cheapest.cost.usd)} ` +
          `(${cheapest.predictedInputTokens} in / ${cheapest.predictedOutputTokens} out) across ${scoped.length} candidate(s).` +
          (cheaperIfAvailable
            ? ` Cheaper if available: ${cheaperIfAvailable.model} (${fmtUsd(cheaperIfAvailable.cost.usd)}).`
            : '')
        : 'No candidate models resolved.';

      return ok(text, structured);
    },
  );
}

/** A cheaper forecast outside the active scope, surfaced honestly (spec 5.4). */
function computeCheaper(
  applyScope: boolean,
  scope: ProviderName[],
  allForecasts: ModelForecast[],
  cheapestInScope: ModelForecast | null,
): { model: string; provider: string; cost: { usd: number; usdMicros: number }; reason: string } | undefined {
  if (!applyScope || !cheapestInScope) return undefined;
  const outside = allForecasts
    .filter((f) => !scope.includes(f.provider as ProviderName))
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
