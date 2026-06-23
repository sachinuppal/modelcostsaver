/**
 * select_optimal_model (spec 6.3): the optimizer. Given a task and a token
 * shape, return the single cheapest model that satisfies the constraints, with
 * full reasoning, the runner-up, the rejected candidates, and a fallbackChain.
 * Applies spec 5.4 two-axis availability scoping. Read-only, offline.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { selectOptimalModel } from '../optimizer/selection';
import { classifyTask } from '../optimizer/classify';
import { resolveProviderScope } from '../optimizer/client-profile';
import type { ModelCapability, ModelTier, ProviderName, TaskClass } from '../catalog/types';
import { TASK_CLASSES } from '../catalog/model-catalog';
import type { ToolContext } from '../server/context.js';
import { ok, fail, fmtUsd, providerEnum, targetEnum, type ToolResult } from './shared.js';

const capabilityEnum = z.enum(['chat', 'tools', 'vision', 'streaming']);

const inputSchema = {
  task: z.string().max(20_000).optional().describe('Free-text task; used for the tier heuristic when taskClass is absent.'),
  taskClass: z.enum(TASK_CLASSES as [TaskClass, ...TaskClass[]]).optional().describe('Explicit task class; overrides the heuristic.'),
  requiredCapabilities: z.array(capabilityEnum).optional().describe('Capabilities the model must support.'),
  maxCostUsd: z.number().nonnegative().optional().describe('Budget ceiling for the predicted call cost.'),
  estimatedInputTokens: z.number().int().nonnegative().describe('Estimated input tokens for the forecast.'),
  estimatedOutputTokens: z.number().int().nonnegative().describe('Estimated output tokens for the forecast.'),
  providers: z.array(providerEnum).optional().describe('Axis 1: provider availability allowlist (spec 5.4).'),
  target: targetEnum.optional().describe('Axis 2: "self" (default) applies the client scope; "code" considers all providers.'),
  includeLocal: z.boolean().optional(),
};

const costShape = z.object({ usd: z.number(), usdMicros: z.number() });

const outputSchema = {
  selected: z
    .object({ model: z.string(), provider: z.string(), tier: z.string(), predictedCost: costShape })
    .nullable(),
  runnerUp: z.object({ model: z.string(), predictedCost: costShape }).optional(),
  rejected: z.array(z.object({ model: z.string(), reason: z.string() })),
  reasoning: z.array(z.string()),
  fallbackChain: z.array(z.string()),
  budgetExceeded: z.boolean().optional(),
  shortfallUsd: z.number().optional(),
  providerScope: z.array(z.string()).optional(),
  scopeSource: z.string().optional(),
  cheaperIfAvailable: z
    .object({ model: z.string(), provider: z.string(), predictedCost: costShape, reason: z.string() })
    .optional(),
  catalogVersion: z.string(),
  asOf: z.string(),
};

type SelectArgs = {
  task?: string;
  taskClass?: TaskClass;
  requiredCapabilities?: ModelCapability[];
  maxCostUsd?: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  providers?: ProviderName[];
  target?: 'self' | 'code';
  includeLocal?: boolean;
};

export function registerSelectOptimalModelTool(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'select_optimal_model',
    {
      title: 'Select optimal model',
      description:
        'Pick the single cheapest model that meets the task tier, capabilities, and budget, with full reasoning and a fallbackChain. Offline.',
      inputSchema,
      outputSchema,
    },
    (args: SelectArgs): ToolResult => {
      if (!args.taskClass && !args.task) {
        return fail('Provide task or taskClass.', 'missing_input');
      }

      const scope = resolveProviderScope({
        clientName: context.getClientName(),
        providersArg: args.providers,
        envProviders: context.config.providers,
        clientProfiles: context.config.clientProfiles,
      });

      /* When there is no explicit taskClass, derive a target tier from the free
         text via the transparent heuristic; the matched rule is echoed below. */
      let targetTier: ModelTier | undefined;
      let classifyReason: string | undefined;
      if (!args.taskClass && args.task) {
        const classified = classifyTask(args.task);
        targetTier = classified.tier;
        classifyReason = classified.reason;
      }

      const result = selectOptimalModel({
        taskClass: args.taskClass,
        targetTier,
        requiredCapabilities: args.requiredCapabilities,
        preferredProvider: context.config.provider,
        estimatedInputTokens: args.estimatedInputTokens,
        estimatedOutputTokens: args.estimatedOutputTokens,
        maxCostUsd: args.maxCostUsd,
        providers: args.providers,
        target: args.target ?? 'self',
        providerScope: scope.providers,
        scopeSource: scope.source,
        includeLocal: args.includeLocal ?? context.config.includeLocal,
      });

      /* Surface the heuristic decision in the reasoning so the agent can correct
         it by passing an explicit taskClass. */
      const reasoning = classifyReason
        ? [`Task text classified: ${classifyReason}`, ...result.reasoning]
        : result.reasoning;

      const structured = {
        selected: result.selected,
        ...(result.runnerUp ? { runnerUp: result.runnerUp } : {}),
        rejected: result.rejected,
        reasoning,
        fallbackChain: result.fallbackChain,
        ...(result.budgetExceeded !== undefined ? { budgetExceeded: result.budgetExceeded } : {}),
        ...(result.shortfallUsd !== undefined ? { shortfallUsd: result.shortfallUsd } : {}),
        ...(result.providerScope ? { providerScope: result.providerScope } : {}),
        ...(result.scopeSource ? { scopeSource: result.scopeSource } : {}),
        ...(result.cheaperIfAvailable ? { cheaperIfAvailable: result.cheaperIfAvailable } : {}),
        catalogVersion: context.catalogMeta.catalogVersion,
        asOf: context.catalogMeta.asOf,
      };

      const text = result.selected
        ? `Selected ${result.selected.model} (${result.selected.provider}, ${result.selected.tier}) ` +
          `at ${fmtUsd(result.selected.predictedCost.usd)}.` +
          (result.budgetExceeded ? ' Over budget (returned cheapest overall).' : '') +
          (result.cheaperIfAvailable
            ? ` Cheaper if available: ${result.cheaperIfAvailable.model} (${fmtUsd(result.cheaperIfAvailable.predictedCost.usd)}).`
            : '')
        : 'No model satisfies the constraints.';

      return ok(text, structured);
    },
  );
}
