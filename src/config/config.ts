/**
 * Configuration resolution (spec Section 9).
 *
 * Precedence, highest first: tool-call argument > environment variable >
 * modelcostsaver.config.json (cwd, then the user config dir) > built-in default.
 * The core needs no secrets; every key here is optional and tunes pricing math,
 * the tokenizer, provider scoping, the opt-in ledger, and the opt-in refresh.
 *
 * Tool-call arguments are applied by the tool handlers themselves (they receive
 * the parsed config and override per call); this module resolves the env and
 * file layers and the defaults.
 */

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { ProviderName } from '../catalog/types';
import { parseProviderList } from '../optimizer/client-profile';
import { log } from '../server/log.js';

export const CONFIG_FILENAME = 'modelcostsaver.config.json';

/** A truthy on/off flag from env or config. Treats anything but on/true/1 as off. */
function flagOn(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;
  const v = value.trim().toLowerCase();
  return v === 'on' || v === 'true' || v === '1' || v === 'yes';
}

/** Parse a finite positive number, else undefined. */
function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Validated shape of modelcostsaver.config.json. All keys optional; unknown keys
 * are ignored so a newer config file does not break an older binary.
 */
const FileConfigSchema = z
  .object({
    fastModel: z.string().optional(),
    standardModel: z.string().optional(),
    reasoningModel: z.string().optional(),
    trivialModel: z.string().optional(),
    provider: z.string().optional(),
    providers: z.array(z.string()).optional(),
    includeLocal: z.union([z.boolean(), z.string()]).optional(),
    charsPerToken: z.union([z.number(), z.string()]).optional(),
    refresh: z.union([z.boolean(), z.string()]).optional(),
    catalogUrl: z.string().optional(),
    ledger: z.union([z.boolean(), z.string()]).optional(),
    telemetry: z.union([z.boolean(), z.string()]).optional(),
    clientProfiles: z.record(z.string(), z.array(z.string())).optional(),
    pricingOverrides: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type FileConfig = z.infer<typeof FileConfigSchema>;

/** Per-tier model id overrides (spec 9). Pins a preferred model per tier. */
export interface TierOverrides {
  fast?: string;
  standard?: string;
  reasoning?: string;
  trivial?: string;
}

/** Fully resolved, immutable configuration handed to the server and tools. */
export interface ResolvedConfig {
  tierOverrides: TierOverrides;
  /** Single-provider bias for selection (spec 9 MODELCOSTSAVER_PROVIDER). */
  provider?: ProviderName;
  /** Axis-1 provider allowlist from env/config (spec 5.4 MODELCOSTSAVER_PROVIDERS). */
  providers?: ProviderName[];
  /** Per-client clientInfo.name -> provider allowlist override (spec 5.4). */
  clientProfiles?: Record<string, ProviderName[]>;
  includeLocal: boolean;
  charsPerToken: number;
  refresh: boolean;
  catalogUrl?: string;
  ledger: boolean;
  /** Always false in v0.1; surfaced for transparency only. */
  telemetry: boolean;
}

const DEFAULT_CHARS_PER_TOKEN = 4;

function asProvider(value: string | undefined): ProviderName | undefined {
  const parsed = parseProviderList(value);
  return parsed?.[0];
}

function asProviderList(value: string[] | undefined): ProviderName[] | undefined {
  if (!value || value.length === 0) return undefined;
  return parseProviderList(value.join(','));
}

/** Read and validate the first modelcostsaver.config.json found (cwd, then user dir). */
function readFileConfig(cwd: string): FileConfig {
  const candidates = [
    join(cwd, CONFIG_FILENAME),
    join(homedir(), '.config', 'modelcostsaver', CONFIG_FILENAME),
    join(homedir(), `.${CONFIG_FILENAME}`),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8'));
      const parsed = FileConfigSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
      log.warn(`ignoring malformed ${path}: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
    } catch (err) {
      log.warn(`failed to read ${path}: ${(err as Error).message}`);
    }
  }
  return {};
}

/**
 * Resolve configuration from env and file layers plus defaults. Never throws: a
 * missing or malformed config file falls back to defaults (logged to stderr).
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): ResolvedConfig {
  const file = readFileConfig(cwd);

  const tierOverrides: TierOverrides = {
    fast: env.MODELCOSTSAVER_FAST_MODEL ?? file.fastModel,
    standard: env.MODELCOSTSAVER_STANDARD_MODEL ?? file.standardModel,
    reasoning: env.MODELCOSTSAVER_REASONING_MODEL ?? file.reasoningModel,
    trivial: env.MODELCOSTSAVER_TRIVIAL_MODEL ?? file.trivialModel,
  };

  const provider = asProvider(env.MODELCOSTSAVER_PROVIDER) ?? asProvider(file.provider);
  const providers =
    parseProviderList(env.MODELCOSTSAVER_PROVIDERS) ?? asProviderList(file.providers);

  const clientProfiles = normalizeClientProfiles(file.clientProfiles);

  const charsPerToken =
    num(env.MODELCOSTSAVER_CHARS_PER_TOKEN) ?? num(file.charsPerToken) ?? DEFAULT_CHARS_PER_TOKEN;

  return {
    tierOverrides,
    provider,
    providers,
    clientProfiles,
    includeLocal: flagOn(env.MODELCOSTSAVER_INCLUDE_LOCAL) || flagOn(file.includeLocal),
    charsPerToken: charsPerToken >= 1 ? charsPerToken : DEFAULT_CHARS_PER_TOKEN,
    refresh: flagOn(env.MODELCOSTSAVER_REFRESH) || flagOn(file.refresh),
    catalogUrl: env.MODELCOSTSAVER_CATALOG_URL ?? file.catalogUrl,
    ledger: flagOn(env.MODELCOSTSAVER_LEDGER) || flagOn(file.ledger),
    telemetry: flagOn(env.MODELCOSTSAVER_TELEMETRY) || flagOn(file.telemetry),
  };
}

/** Keep only valid provider names in each client profile; drop empty profiles. */
function normalizeClientProfiles(
  raw: Record<string, string[]> | undefined,
): Record<string, ProviderName[]> | undefined {
  if (!raw) return undefined;
  const out: Record<string, ProviderName[]> = {};
  for (const [client, list] of Object.entries(raw)) {
    const parsed = asProviderList(list);
    if (parsed) out[client] = parsed;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Directory for the opt-in ledger and refresh cache. */
export function configDir(): string {
  return join(homedir(), '.config', 'modelcostsaver');
}
