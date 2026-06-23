/**
 * IDE install helper (spec Section 10). Writes the canonical stdio server entry
 * into the named client's MCP config file, idempotently, at the correct path and
 * in the correct key shape per spec 10.2. Re-running must not duplicate the entry;
 * an existing config with unrelated servers must be preserved; a config file that
 * is not valid JSON must abort rather than be clobbered.
 *
 * home and cwd are injected so these tests write into a temp dir and never touch
 * the developer's real config.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  CLIENTS,
  clientConfigPath,
  upsertServerEntry,
  runInstall,
  SERVER_KEY,
} from '../src/cli/install';

let home: string;
let cwd: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'modelcostsaver-home-'));
  cwd = mkdtempSync(join(tmpdir(), 'modelcostsaver-cwd-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('client descriptors', () => {
  it('covers every client named in the spec', () => {
    const names = Object.keys(CLIENTS).sort();
    expect(names).toEqual(
      ['antigravity', 'claude', 'cline', 'cursor', 'vscode', 'windsurf', 'zed'].sort(),
    );
  });

  it('resolves the documented Cursor path under home', () => {
    expect(clientConfigPath('cursor', { home, cwd })).toBe(join(home, '.cursor', 'mcp.json'));
  });

  it('resolves the documented VS Code path under cwd', () => {
    expect(clientConfigPath('vscode', { home, cwd })).toBe(join(cwd, '.vscode', 'mcp.json'));
  });

  it('resolves the documented Windsurf path under home', () => {
    expect(clientConfigPath('windsurf', { home, cwd })).toBe(
      join(home, '.codeium', 'windsurf', 'mcp_config.json'),
    );
  });

  it('resolves the documented Claude Code project path under cwd', () => {
    expect(clientConfigPath('claude', { home, cwd })).toBe(join(cwd, '.mcp.json'));
  });
});

describe('upsertServerEntry (pure, idempotent)', () => {
  it('adds the server under mcpServers when absent', () => {
    const { next, changed } = upsertServerEntry({}, 'mcpServers', false, {});
    expect(changed).toBe(true);
    expect((next.mcpServers as Record<string, unknown>)[SERVER_KEY]).toEqual({
      command: 'npx',
      args: ['-y', '@workswarm/modelcostsaver'],
      env: {},
    });
  });

  it('adds type: stdio under the servers shape (VS Code)', () => {
    const { next } = upsertServerEntry({}, 'servers', true, {});
    const entry = (next.servers as Record<string, Record<string, unknown>>)[SERVER_KEY];
    expect(entry.type).toBe('stdio');
    expect(entry.command).toBe('npx');
  });

  it('is idempotent: a second upsert reports no change', () => {
    const first = upsertServerEntry({}, 'mcpServers', false, {});
    const second = upsertServerEntry(first.next, 'mcpServers', false, {});
    expect(second.changed).toBe(false);
    expect(second.next).toEqual(first.next);
  });

  it('preserves unrelated servers already present', () => {
    const existing = { mcpServers: { other: { command: 'foo', args: [] } } };
    const { next } = upsertServerEntry(existing, 'mcpServers', false, {});
    const servers = next.mcpServers as Record<string, unknown>;
    expect(servers.other).toEqual({ command: 'foo', args: [] });
    expect(servers[SERVER_KEY]).toBeDefined();
  });

  it('updates an existing modelcostsaver entry in place when env changes', () => {
    const first = upsertServerEntry({}, 'mcpServers', false, {});
    const second = upsertServerEntry(first.next, 'mcpServers', false, { MODELCOSTSAVER_PROVIDERS: 'anthropic' });
    expect(second.changed).toBe(true);
    const entry = (second.next.mcpServers as Record<string, Record<string, unknown>>)[SERVER_KEY];
    expect(entry.env).toEqual({ MODELCOSTSAVER_PROVIDERS: 'anthropic' });
  });

  it('does not mutate the input object', () => {
    const existing = { mcpServers: { other: { command: 'foo' } } };
    const snapshot = JSON.stringify(existing);
    upsertServerEntry(existing, 'mcpServers', false, {});
    expect(JSON.stringify(existing)).toBe(snapshot);
  });
});

describe('runInstall (file I/O)', () => {
  it('writes a new Cursor config with the mcpServers shape', async () => {
    const result = await runInstall(['--client', 'cursor'], { home, cwd });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    const path = join(home, '.cursor', 'mcp.json');
    expect(existsSync(path)).toBe(true);
    const cfg = readJson(path);
    expect((cfg.mcpServers as Record<string, unknown>)[SERVER_KEY]).toBeDefined();
  });

  it('writes a VS Code config with type: stdio', async () => {
    await runInstall(['--client', 'vscode'], { home, cwd });
    const cfg = readJson(join(cwd, '.vscode', 'mcp.json'));
    const entry = (cfg.servers as Record<string, Record<string, unknown>>)[SERVER_KEY];
    expect(entry.type).toBe('stdio');
  });

  it('seeds MODELCOSTSAVER_PROVIDERS=anthropic for the Claude client', async () => {
    await runInstall(['--client', 'claude'], { home, cwd });
    const cfg = readJson(join(cwd, '.mcp.json'));
    const entry = (cfg.mcpServers as Record<string, Record<string, unknown>>)[SERVER_KEY];
    expect(entry.env).toEqual({ MODELCOSTSAVER_PROVIDERS: 'anthropic' });
  });

  it('is idempotent across two runs (no duplicate, second reports unchanged)', async () => {
    await runInstall(['--client', 'cursor'], { home, cwd });
    const second = await runInstall(['--client', 'cursor'], { home, cwd });
    expect(second.changed).toBe(false);
    const cfg = readJson(join(home, '.cursor', 'mcp.json'));
    expect(Object.keys(cfg.mcpServers as Record<string, unknown>)).toEqual([SERVER_KEY]);
  });

  it('preserves an existing unrelated server entry in the file', async () => {
    const path = join(home, '.cursor', 'mcp.json');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ mcpServers: { other: { command: 'x', args: [] } } }), 'utf8');
    await runInstall(['--client', 'cursor'], { home, cwd });
    const cfg = readJson(path);
    const servers = cfg.mcpServers as Record<string, unknown>;
    expect(servers.other).toEqual({ command: 'x', args: [] });
    expect(servers[SERVER_KEY]).toBeDefined();
  });

  it('aborts (does not clobber) when the existing config is not valid JSON', async () => {
    const path = join(home, '.cursor', 'mcp.json');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{ this is not json', 'utf8');
    const result = await runInstall(['--client', 'cursor'], { home, cwd });
    expect(result.ok).toBe(false);
    /* The malformed file is left exactly as it was. */
    expect(readFileSync(path, 'utf8')).toBe('{ this is not json');
  });

  it('returns an error for an unknown client', async () => {
    const result = await runInstall(['--client', 'emacs'], { home, cwd });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unknown client/i);
  });

  it('returns an error when no client is given', async () => {
    const result = await runInstall([], { home, cwd });
    expect(result.ok).toBe(false);
  });
});
