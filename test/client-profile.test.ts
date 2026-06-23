import { describe, it, expect } from 'vitest';
import {
  resolveProviderScope,
  defaultProvidersForClient,
  parseProviderList,
} from '../src/optimizer/client-profile';
import { selectOptimalModel } from '../src/optimizer/selection';

describe('defaultProvidersForClient', () => {
  it('maps claude clients to anthropic-only', () => {
    expect(defaultProvidersForClient('claude-ai').providers).toEqual(['anthropic']);
    expect(defaultProvidersForClient('Claude Desktop').matched).toBe(true);
  });
  it('maps multi-provider and unknown clients to all public providers', () => {
    expect(defaultProvidersForClient('cursor').providers).toEqual(['anthropic', 'gemini', 'openai']);
    expect(defaultProvidersForClient('windsurf').matched).toBe(false);
    expect(defaultProvidersForClient(undefined).matched).toBe(false);
  });
});

describe('resolveProviderScope precedence', () => {
  it('arg wins over everything', () => {
    const r = resolveProviderScope({
      clientName: 'claude-ai',
      providersArg: ['openai'],
      envProviders: ['gemini'],
      configProviders: ['anthropic'],
    });
    expect(r).toEqual({ providers: ['openai'], source: 'arg' });
  });
  it('env wins over config and client', () => {
    const r = resolveProviderScope({
      clientName: 'claude-ai',
      envProviders: ['gemini'],
      configProviders: ['anthropic'],
    });
    expect(r).toEqual({ providers: ['gemini'], source: 'env' });
  });
  it('config wins over the client default', () => {
    const r = resolveProviderScope({ clientName: 'claude-ai', configProviders: ['openai'] });
    expect(r).toEqual({ providers: ['openai'], source: 'config' });
  });
  it('a config clientProfile override is sourced as config', () => {
    const r = resolveProviderScope({
      clientName: 'my-client',
      clientProfiles: { 'my-client': ['gemini'] },
    });
    expect(r).toEqual({ providers: ['gemini'], source: 'config' });
  });
  it('falls back to the client-derived default', () => {
    const r = resolveProviderScope({ clientName: 'claude-ai' });
    expect(r).toEqual({ providers: ['anthropic'], source: 'client' });
  });
  it('falls back to all providers for an unknown client', () => {
    const r = resolveProviderScope({ clientName: 'cursor' });
    expect(r.source).toBe('default-all');
    expect(r.providers).toEqual(['anthropic', 'gemini', 'openai']);
  });
});

describe('parseProviderList', () => {
  it('parses and validates a comma list', () => {
    expect(parseProviderList('anthropic, gemini')).toEqual(['anthropic', 'gemini']);
  });
  it('drops unknown tokens and returns undefined when all unknown', () => {
    expect(parseProviderList('foo, bar')).toBeUndefined();
    expect(parseProviderList('')).toBeUndefined();
    expect(parseProviderList(undefined)).toBeUndefined();
  });
});

describe('two-axis scoping through selectOptimalModel (spec 5.4)', () => {
  const baseTokens = { estimatedInputTokens: 5000, estimatedOutputTokens: 800 };

  it('claude-ai + target self on summarise selects haiku and names a cheaper non-anthropic model', () => {
    const scope = resolveProviderScope({ clientName: 'claude-ai' });
    const result = selectOptimalModel({
      taskClass: 'summarise',
      target: 'self',
      providerScope: scope.providers,
      scopeSource: scope.source,
      ...baseTokens,
    });
    expect(result.selected!.model).toBe('claude-haiku-4-5-20251001');
    expect(result.providerScope).toEqual(['anthropic']);
    expect(result.scopeSource).toBe('client');
    expect(result.cheaperIfAvailable).toBeDefined();
    expect(result.cheaperIfAvailable!.provider).not.toBe('anthropic');
    /* Cheapest fast-or-higher model outside anthropic is gpt-4.1-mini ($0.00328);
       gemini-2.5-flash ($0.0035) is pricier now that its output is 2.50. */
    expect(result.cheaperIfAvailable!.model).toBe('gpt-4.1-mini');
    expect(result.cheaperIfAvailable!.reason).toMatch(/target=code/);
  });

  it('the SAME call with target code selects the globally-cheapest model', () => {
    const scope = resolveProviderScope({ clientName: 'claude-ai' });
    const result = selectOptimalModel({
      taskClass: 'summarise',
      target: 'code',
      providerScope: scope.providers,
      scopeSource: scope.source,
      ...baseTokens,
    });
    /* target=code ignores the client scope -> globally cheapest fast-tier. */
    expect(result.selected!.model).toBe('gpt-4.1-mini');
    expect(result.cheaperIfAvailable).toBeUndefined();
  });

  it('an explicit providers arg overrides the client default', () => {
    const scope = resolveProviderScope({ clientName: 'claude-ai', providersArg: ['openai'] });
    const result = selectOptimalModel({
      taskClass: 'summarise',
      target: 'self',
      providers: scope.providers,
      scopeSource: scope.source,
      ...baseTokens,
    });
    expect(result.selected!.provider).toBe('openai');
    expect(result.providerScope).toEqual(['openai']);
    expect(result.scopeSource).toBe('arg');
  });
});
