/**
 * optimize_request (spec 6.6): "I plan to call model X, can I do better?" Given
 * a current model and a token shape, return the cheaper capable alternative and
 * the savings (absolute and percent). Default is same-provider (a provider
 * switch needs a different key); crossProvider widens the search. Applies the
 * spec 5.4 availability scope. Read-only, offline.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { optimizeRequest } from '../optimizer/optimize';
import type { ProviderName, TaskClass } from '../catalog/types';
import { TASK_CLASSES } from '../catalog/model-catalog';
import type { ToolContext } from '../server/context.js';
import { ok, fail, fmtUsd, providerEnum, targetEnum, resolveScope, type ToolResult } from './shared.js';

const inputSchema = {
  currentModel: z.string().describe('The model you plan to call (alias or id).'),
  inputTokens: z.number().int().nonnegative().describe('Input tokens for the call.'),
  outputTokens: z.number().int().nonnegative().describe('Output tokens for the call.'),
  taskClass: z.enum(TASK_CLASSES as [TaskClass, ...TaskClass[]]).optional().describe('Task class; sets the tier the recommendation must still meet.'),
  crossProvider: z.boolean().optional().describe('Consider other providers too (may need a different API key). Default false.'),
  providers: z.array(providerEnum).optional().describe('Axis 1: provider availability allowlist (spec 5.4).'),
  target: targetEnum.optional().describe('Axis 2: "self" (default) applies the client scope; "code" considers all providers.'),
  includeLocal: z.boolean().optional(),
};

const costShape = z.object({ model: z.string(), provider: z.string(), tier: z.string(), usd: z.number(), usdMicros: z.number() });

const outputSchema = {
  current: costShape.nullable(),
  recommended: costShape.nullable(),
  savingsUsd: z.number(),
  savingsPct: z.number(),
  alreadyOptimal: z.boolean(),
  reasoning: z.array(z.string()),
  providerScope: z.array(z.string()),
  scopeSource: z.string(),
  catalogVersion: z.string(),
  asOf: z.string(),
};

type OptimizeArgs = {
  currentModel: string;
  inputTokens: number;
  outputTokens: number;
  taskClass?: TaskClass;
  crossProvider?: boolean;
  providers?: ProviderName[];
  target?: 'self' | 'code';
  includeLocal?: boolean;
};

export function registerOptimizeRequestTool(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'optimize_request',
    {
      title: 'Optimize request',
      description:
        'Check whether a cheaper capable model exists for a call you plan to make, and report the savings. Offline.',
      inputSchema,
      outputSchema,
    },
    (args: OptimizeArgs): ToolResult => {
      const { providerScope, scopeSource, applyScope } = resolveScope(
        context,
        args.providers,
        args.target ?? 'self',
      );

      const result = optimizeRequest({
        currentModel: args.currentModel,
        inputTokens: args.inputTokens,
        outputTokens: args.outputTokens,
        taskClass: args.taskClass,
        crossProvider: args.crossProvider ?? false,
        /* Scope the cross-provider search to what the client can invoke (only
           when target=self or an explicit providers arg was supplied). */
        allowedProviders: applyScope ? providerScope : undefined,
        includeLocal: args.includeLocal ?? context.config.includeLocal,
      });

      if (result.unknownModel) {
        return fail(`Unknown model '${result.unknownModel}'.`, 'unknown_model');
      }

      const structured = {
        current: result.current,
        recommended: result.recommended,
        savingsUsd: result.savingsUsd,
        savingsPct: result.savingsPct,
        alreadyOptimal: result.alreadyOptimal,
        reasoning: result.reasoning,
        providerScope,
        scopeSource,
        catalogVersion: context.catalogMeta.catalogVersion,
        asOf: context.catalogMeta.asOf,
      };

      const text = result.alreadyOptimal
        ? `${result.current?.model} is already the cheapest capable option at this tier.`
        : `Switch ${result.current?.model} -> ${result.recommended?.model}: ` +
          `${fmtUsd(result.current?.usd ?? 0)} -> ${fmtUsd(result.recommended?.usd ?? 0)}, ` +
          `save ${fmtUsd(result.savingsUsd)} (${result.savingsPct.toFixed(1)}%).`;

      return ok(text, structured);
    },
  );
}
