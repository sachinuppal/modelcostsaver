/**
 * IDE install helper (spec Section 10).
 *
 * Writes the canonical stdio server entry into a named client's MCP config file,
 * idempotently, at the correct path and in the correct key shape (spec 10.2).
 * Re-running updates the entry in place rather than duplicating it; unrelated
 * servers already in the file are preserved; a config that is not valid JSON
 * aborts the write rather than clobbering it.
 *
 * ModelCostSaver needs no API keys, so the env block is empty for every client
 * except the Anthropic-only ones, where MODELCOSTSAVER_PROVIDERS=anthropic is
 * seeded as a sensible default (runtime clientInfo detection is still the primary
 * mechanism; spec 5.4 install delta). All human output goes to stderr; stdout stays clean.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { log } from '../server/log.js';

/** The server's key inside the client config's server map. */
export const SERVER_KEY = 'modelcostsaver';

/** The canonical stdio launch command (spec 10.1): npx, no keys required. */
const COMMAND = 'npx';
const ARGS = ['-y', '@workswarm/modelcostsaver'];

/** Where a client's server entry lives: nested under mcpServers or servers. */
type ConfigShape = 'mcpServers' | 'servers';

/** Injected paths so tests (and odd setups) can redirect home/cwd. */
export interface InstallEnv {
  home?: string;
  cwd?: string;
}

interface ClientDescriptor {
  label: string;
  /** Resolve the absolute config path from home and cwd. */
  path(home: string, cwd: string): string;
  shape: ConfigShape;
  /** VS Code requires an explicit type: stdio on each server entry. */
  includeType: boolean;
  /** Default env to seed (e.g. anthropic-only scope for Claude clients). */
  defaultEnv: Record<string, string>;
}

/**
 * Per-client config descriptors (spec 10.2). Paths verified against each client's
 * documented MCP config location. Cursor/Windsurf are user-global; VS Code, Cline,
 * Zed, Antigravity, and Claude Code are project-scoped files written into cwd.
 */
export const CLIENTS: Record<string, ClientDescriptor> = {
  cursor: {
    label: 'Cursor',
    path: (home) => join(home, '.cursor', 'mcp.json'),
    shape: 'mcpServers',
    includeType: false,
    defaultEnv: {},
  },
  claude: {
    label: 'Claude Code',
    /* Project-scoped .mcp.json in the repo root (spec 10.2). Claude clients run
       Claude for their own inference, so default the recommendation scope to
       anthropic; overridable at runtime via MODELCOSTSAVER_PROVIDERS or per call. */
    path: (_home, cwd) => join(cwd, '.mcp.json'),
    shape: 'mcpServers',
    includeType: false,
    defaultEnv: { MODELCOSTSAVER_PROVIDERS: 'anthropic' },
  },
  vscode: {
    label: 'VS Code / Copilot',
    path: (_home, cwd) => join(cwd, '.vscode', 'mcp.json'),
    shape: 'servers',
    includeType: true,
    defaultEnv: {},
  },
  windsurf: {
    label: 'Windsurf',
    path: (home) => join(home, '.codeium', 'windsurf', 'mcp_config.json'),
    shape: 'mcpServers',
    includeType: false,
    defaultEnv: {},
  },
  cline: {
    label: 'Cline',
    path: (home) =>
      join(
        home,
        '.vscode',
        'globalStorage',
        'saoudrizwan.claude-dev',
        'settings',
        'cline_mcp_settings.json',
      ),
    shape: 'mcpServers',
    includeType: false,
    defaultEnv: {},
  },
  zed: {
    label: 'Zed',
    /* Zed nests MCP servers under context_servers in its settings.json. */
    path: (home) => join(home, '.config', 'zed', 'settings.json'),
    shape: 'mcpServers',
    includeType: false,
    defaultEnv: {},
  },
  antigravity: {
    label: 'Antigravity',
    path: (_home, cwd) => join(cwd, '.antigravity', 'mcp.json'),
    shape: 'mcpServers',
    includeType: false,
    defaultEnv: {},
  },
};

/** Resolve the config file path for a client using the injected (or real) env. */
export function clientConfigPath(client: string, env: InstallEnv = {}): string {
  const descriptor = CLIENTS[client];
  if (!descriptor) throw new Error(`unknown client '${client}'`);
  return descriptor.path(env.home ?? homedir(), env.cwd ?? process.cwd());
}

/** Build the server entry object for a given shape and env. */
function buildEntry(includeType: boolean, env: Record<string, string>): Record<string, unknown> {
  return {
    command: COMMAND,
    args: [...ARGS],
    ...(includeType ? { type: 'stdio' } : {}),
    env: { ...env },
  };
}

/**
 * Pure, idempotent merge: return the config object with the modelcostsaver server
 * entry present exactly once under the given shape, plus whether anything changed.
 * An existing modelcostsaver entry that already matches is left untouched (no change);
 * one that differs is replaced in place. Unrelated servers and other top-level
 * keys are preserved. Never mutates the input (deep-cloned first).
 */
export function upsertServerEntry(
  existing: Record<string, unknown>,
  shape: ConfigShape,
  includeType: boolean,
  env: Record<string, string>,
): { next: Record<string, unknown>; changed: boolean } {
  const next = structuredClone(existing ?? {}) as Record<string, unknown>;

  const current = next[shape];
  const map: Record<string, unknown> =
    current && typeof current === 'object' && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  next[shape] = map;

  const desired = buildEntry(includeType, env);
  const existingEntry = map[SERVER_KEY];
  if (existingEntry && JSON.stringify(existingEntry) === JSON.stringify(desired)) {
    return { next: existing, changed: false };
  }
  map[SERVER_KEY] = desired;
  return { next, changed: true };
}

/** Outcome of an install attempt; returned (not thrown) so callers can react. */
export interface InstallResult {
  ok: boolean;
  changed: boolean;
  path?: string;
  client?: string;
  error?: string;
}

/** Parse the --client value out of an argv slice. */
function parseClient(args: string[]): string | undefined {
  const idx = args.indexOf('--client');
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  /* Also accept a bare positional client name: `install cursor`. */
  const positional = args.find((a) => !a.startsWith('-'));
  return positional;
}

/**
 * Read, merge, and write the client config. Returns an InstallResult; the only
 * failure that intentionally does NOT write is an unparseable existing file
 * (abort rather than clobber). home and cwd are injectable for tests.
 */
export async function runInstall(args: string[], env: InstallEnv = {}): Promise<InstallResult> {
  const client = parseClient(args);
  if (!client) {
    return {
      ok: false,
      changed: false,
      error: `no client given. Usage: modelcostsaver install --client <${Object.keys(CLIENTS).join('|')}>`,
    };
  }
  const descriptor = CLIENTS[client];
  if (!descriptor) {
    return {
      ok: false,
      changed: false,
      error: `unknown client '${client}'. Known: ${Object.keys(CLIENTS).join(', ')}`,
    };
  }

  const path = clientConfigPath(client, env);

  let existing: Record<string, unknown> = {};
  if (existsSync(path)) {
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch (err) {
      return { ok: false, changed: false, path, client, error: `could not read ${path}: ${(err as Error).message}` };
    }
    if (raw.trim() !== '') {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          existing = parsed as Record<string, unknown>;
        } else {
          return { ok: false, changed: false, path, client, error: `${path} is not a JSON object; aborting.` };
        }
      } catch {
        return {
          ok: false,
          changed: false,
          path,
          client,
          error: `${path} is not valid JSON; aborting so it is not overwritten.`,
        };
      }
    }
  }

  const { next, changed } = upsertServerEntry(existing, descriptor.shape, descriptor.includeType, descriptor.defaultEnv);

  if (changed) {
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    } catch (err) {
      return { ok: false, changed: false, path, client, error: `could not write ${path}: ${(err as Error).message}` };
    }
  }

  return { ok: true, changed, path, client };
}

/**
 * CLI wrapper: run the install and report to stderr, setting a non-zero exit code
 * on failure. The bin calls this; tests call runInstall directly for the result.
 */
export async function runInstallCli(args: string[]): Promise<void> {
  const result = await runInstall(args);
  if (!result.ok) {
    log.error(result.error ?? 'install failed.');
    process.exitCode = 1;
    return;
  }
  const descriptor = result.client ? CLIENTS[result.client] : undefined;
  log.info(
    `${descriptor?.label ?? result.client}: ${result.changed ? 'wrote' : 'already up to date at'} ${result.path}`,
  );
  log.info('Restart the client to pick up the modelcostsaver server. No API keys are required.');
}
