/**
 * Client-aware provider scoping (spec 5.4, Axis 1).
 *
 * The connected MCP client's identity (from the initialize handshake
 * clientInfo.name) sets a DEFAULT provider availability scope: an
 * Anthropic-only client (Claude Code, Claude Desktop) defaults to anthropic,
 * because the agent's own inference there is Claude; multi-provider clients and
 * unknown clients default to all providers.
 *
 * Detection only sets a default. The scope is always overridable in precedence
 * order: per-call arg > env > config > client-derived default > all. The result
 * carries its source so the selection reasoning can state the assumption
 * honestly.
 */

import type { ProviderName } from '../catalog/types';
import type { ScopeSource } from './selection';

export const ALL_PROVIDERS: ProviderName[] = ['anthropic', 'gemini', 'openai', 'local'];
/** The cloud providers a default install reasons over (local excluded). */
export const PUBLIC_PROVIDERS: ProviderName[] = ['anthropic', 'gemini', 'openai'];

/**
 * Map an MCP client name to its default provider allowlist. Names containing
 * "claude" (case-insensitive) are Anthropic-only; everything else (cursor,
 * vscode, windsurf, cline, zed, antigravity, and unknown) gets all public
 * providers. Never silently over-restricts an unknown client.
 */
export function defaultProvidersForClient(clientName?: string): {
  providers: ProviderName[];
  matched: boolean;
} {
  if (clientName && /claude/i.test(clientName)) {
    return { providers: ['anthropic'], matched: true };
  }
  return { providers: PUBLIC_PROVIDERS, matched: false };
}

export interface ResolveProviderScopeInput {
  /** From the MCP initialize handshake clientInfo.name. */
  clientName?: string;
  /** Per-call providers arg (highest precedence). */
  providersArg?: ProviderName[];
  /** MODELCOSTSAVER_PROVIDERS env, already parsed to a list. */
  envProviders?: ProviderName[];
  /** providers from modelcostsaver.config.json. */
  configProviders?: ProviderName[];
  /** Per-client override map from config (clientProfiles). */
  clientProfiles?: Record<string, ProviderName[]>;
}

export interface ResolvedProviderScope {
  providers: ProviderName[];
  source: ScopeSource;
}

function nonEmpty(list: ProviderName[] | undefined): list is ProviderName[] {
  return Array.isArray(list) && list.length > 0;
}

/**
 * Resolve the active provider availability scope by precedence:
 * arg > env > config > config client-profile > client-derived default > all.
 */
export function resolveProviderScope(input: ResolveProviderScopeInput): ResolvedProviderScope {
  if (nonEmpty(input.providersArg)) {
    return { providers: input.providersArg, source: 'arg' };
  }
  if (nonEmpty(input.envProviders)) {
    return { providers: input.envProviders, source: 'env' };
  }
  if (nonEmpty(input.configProviders)) {
    return { providers: input.configProviders, source: 'config' };
  }
  /* A config client-profile override for this exact client name wins over the
     built-in client default but is still a config-sourced decision. */
  if (input.clientName && input.clientProfiles) {
    const profile = input.clientProfiles[input.clientName];
    if (nonEmpty(profile)) {
      return { providers: profile, source: 'config' };
    }
  }
  const fromClient = defaultProvidersForClient(input.clientName);
  if (fromClient.matched) {
    return { providers: fromClient.providers, source: 'client' };
  }
  return { providers: PUBLIC_PROVIDERS, source: 'default-all' };
}

/**
 * Parse a comma-separated provider list (e.g. from MODELCOSTSAVER_PROVIDERS) into a
 * validated ProviderName[]. Unknown tokens are dropped; an all-unknown or empty
 * input yields undefined so the next precedence level applies.
 */
export function parseProviderList(raw: string | undefined): ProviderName[] | undefined {
  if (!raw) return undefined;
  const parsed = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is ProviderName => (ALL_PROVIDERS as string[]).includes(s));
  return parsed.length > 0 ? parsed : undefined;
}
