/**
 * Shared tool helpers: cost display formatting, provider-scope resolution from
 * the tool context (spec 5.4), and the standard tool-result envelope (a human
 * content text block plus a structuredContent object).
 */

import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ProviderName } from '../catalog/types';
import type { ScopeSource } from '../optimizer/selection';
import { resolveProviderScope } from '../optimizer/client-profile';
import type { ToolContext } from '../server/context.js';

/** zod enum of the public provider names accepted on tool inputs. */
export const providerEnum = z.enum(['anthropic', 'gemini', 'openai', 'local']);

/** zod enum for the Axis-2 recommendation target. */
export const targetEnum = z.enum(['self', 'code']);

/**
 * A standard MCP tool result: a human text block plus a structured object. This
 * is the SDK's CallToolResult so the registerTool callback accepts it directly
 * (the SDK type carries an open index signature a named interface would not).
 */
export type ToolResult = CallToolResult;

/** Build a non-error tool result from a human summary and a structured object. */
export function ok(text: string, structuredContent: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text }], structuredContent };
}

/**
 * Build an error tool result. The error is structured (never thrown into the
 * transport) so the agent can read code and message and recover.
 */
export function fail(message: string, code = 'invalid_request'): ToolResult {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    structuredContent: { error: { code, message } },
    isError: true,
  };
}

/** Render a USD amount at full precision for the human content block. */
export function fmtUsd(usd: number): string {
  /* Show enough decimals that a sub-cent prediction is visible, trimming
     trailing zeros so common values read cleanly. */
  return `$${usd.toFixed(6).replace(/0+$/, '').replace(/\.$/, '.0')}`;
}

/**
 * Resolve the effective Axis-1 provider scope for a cost tool call, combining
 * the per-call providers arg, env/config from the context, and the connected
 * client's derived default. Returns the scope, its source, and whether the
 * client-derived scope should be applied (it is ignored when target is 'code').
 */
export function resolveScope(
  context: ToolContext,
  providersArg: ProviderName[] | undefined,
  target: 'self' | 'code',
): { providerScope: ProviderName[]; scopeSource: ScopeSource; applyScope: boolean } {
  const resolved = resolveProviderScope({
    clientName: context.getClientName(),
    providersArg,
    envProviders: context.config.providers,
    configProviders: undefined,
    clientProfiles: context.config.clientProfiles,
  });
  /* Axis 2: target 'code' means the developer supplies the key in their own
     app, so the client-derived scope does not constrain the recommendation. An
     explicit providers arg still narrows it. */
  const applyScope = target === 'self' || resolved.source === 'arg';
  return {
    providerScope: resolved.providers,
    scopeSource: resolved.source,
    applyScope,
  };
}
