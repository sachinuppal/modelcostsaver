import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config/config';

/* cwd points at the package root for these tests; there is no modelcostsaver.config.json
   committed there, so file-layer resolution is a no-op and only env + defaults
   apply. A non-existent cwd guarantees the file layer is empty. */
const NO_FILE_CWD = '/tmp/modelcostsaver-no-such-dir-xyz';

describe('loadConfig: defaults', () => {
  it('returns safe defaults with an empty environment', () => {
    const cfg = loadConfig({}, NO_FILE_CWD);
    expect(cfg.charsPerToken).toBe(4);
    expect(cfg.includeLocal).toBe(false);
    expect(cfg.refresh).toBe(false);
    expect(cfg.ledger).toBe(false);
    expect(cfg.telemetry).toBe(false);
    expect(cfg.provider).toBeUndefined();
    expect(cfg.providers).toBeUndefined();
  });
});

describe('loadConfig: env precedence and parsing', () => {
  it('parses tier overrides and provider', () => {
    const cfg = loadConfig(
      {
        MODELCOSTSAVER_FAST_MODEL: 'haiku',
        MODELCOSTSAVER_STANDARD_MODEL: 'sonnet',
        MODELCOSTSAVER_PROVIDER: 'anthropic',
      },
      NO_FILE_CWD,
    );
    expect(cfg.tierOverrides.fast).toBe('haiku');
    expect(cfg.tierOverrides.standard).toBe('sonnet');
    expect(cfg.provider).toBe('anthropic');
  });

  it('parses MODELCOSTSAVER_PROVIDERS into a validated list, dropping unknowns', () => {
    const cfg = loadConfig({ MODELCOSTSAVER_PROVIDERS: 'anthropic, openai, bogus' }, NO_FILE_CWD);
    expect(cfg.providers).toEqual(['anthropic', 'openai']);
  });

  it('treats on/true/1 as enabled and everything else as off', () => {
    expect(loadConfig({ MODELCOSTSAVER_LEDGER: 'on' }, NO_FILE_CWD).ledger).toBe(true);
    expect(loadConfig({ MODELCOSTSAVER_LEDGER: 'true' }, NO_FILE_CWD).ledger).toBe(true);
    expect(loadConfig({ MODELCOSTSAVER_LEDGER: '1' }, NO_FILE_CWD).ledger).toBe(true);
    expect(loadConfig({ MODELCOSTSAVER_LEDGER: 'off' }, NO_FILE_CWD).ledger).toBe(false);
    expect(loadConfig({ MODELCOSTSAVER_LEDGER: 'yep' }, NO_FILE_CWD).ledger).toBe(false);
  });

  it('clamps a non-numeric or sub-1 charsPerToken to the default', () => {
    expect(loadConfig({ MODELCOSTSAVER_CHARS_PER_TOKEN: 'abc' }, NO_FILE_CWD).charsPerToken).toBe(4);
    expect(loadConfig({ MODELCOSTSAVER_CHARS_PER_TOKEN: '0' }, NO_FILE_CWD).charsPerToken).toBe(4);
    expect(loadConfig({ MODELCOSTSAVER_CHARS_PER_TOKEN: '3.5' }, NO_FILE_CWD).charsPerToken).toBe(3.5);
  });
});

describe('loadConfig: never throws on a missing file', () => {
  it('falls back to defaults when the config dir does not exist', () => {
    expect(() => loadConfig({}, NO_FILE_CWD)).not.toThrow();
  });
});
