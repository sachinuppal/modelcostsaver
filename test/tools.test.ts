import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTools } from '../src/tools/register';
import { registerPrompts } from '../src/prompts/cost-aware';
import { registerCatalogResource, CATALOG_URI } from '../src/resources/catalog-resource';
import { BUNDLED_CATALOG_META } from '../src/catalog/meta';
import type { ToolContext } from '../src/server/context';
import type { ResolvedConfig } from '../src/config/config';

const BASE_CONFIG: ResolvedConfig = {
  tierOverrides: {},
  includeLocal: false,
  charsPerToken: 4,
  refresh: false,
  ledger: false,
  telemetry: false,
};

/**
 * Wire a Client to a freshly built server over an in-memory transport pair. The
 * client's name becomes the server-visible clientInfo.name, so this exercises
 * the real spec-5.4 scoping derived from the handshake. config overrides merge
 * over the base; clientName defaults to a multi-provider client.
 */
async function connectClient(opts: {
  clientName?: string;
  config?: Partial<ResolvedConfig>;
} = {}): Promise<Client> {
  const server = new McpServer({ name: 'modelcostsaver', version: '0.1.0' });
  const config: ResolvedConfig = { ...BASE_CONFIG, ...opts.config };
  const context: ToolContext = {
    config,
    catalogMeta: BUNDLED_CATALOG_META,
    getClientName: () => server.server.getClientVersion()?.name,
  };
  registerTools(server, context);
  registerPrompts(server);
  registerCatalogResource(server, context);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: opts.clientName ?? 'cursor', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

/** Read the structuredContent off a tool result as a typed record. */
function structured(result: unknown): Record<string, any> {
  return (result as { structuredContent: Record<string, any> }).structuredContent;
}

describe('tool surface: the seven core tools are present', () => {
  it('lists the seven core tools (record_usage absent when the ledger is off)', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    for (const expected of [
      'estimate_cost',
      'predict_cost',
      'select_optimal_model',
      'compare_models',
      'list_models',
      'get_pricing',
      'optimize_request',
    ]) {
      expect(names).toContain(expected);
    }
    expect(names).not.toContain('record_usage');
    await client.close();
  });

  it('registers record_usage when the ledger is enabled', async () => {
    const client = await connectClient({ config: { ledger: true } });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('record_usage');
    await client.close();
  });
});

describe('estimate_cost', () => {
  it('returns a structured cost with usd, usdMicros, and catalogVersion', async () => {
    const client = await connectClient();
    const res = await client.callTool({
      name: 'estimate_cost',
      arguments: { model: 'haiku', inputTokens: 1000, outputTokens: 100 },
    });
    const s = structured(res);
    expect(s.model).toBe('claude-haiku-4-5-20251001');
    /* 1000/1e6*1.0 + 100/1e6*5 = 0.0010 + 0.0005 = 0.0015 */
    expect(s.cost.usd).toBeCloseTo(0.0015, 9);
    expect(s.cost.usdMicros).toBe(1500);
    expect(s.tokensWereEstimated).toBe(false);
    expect(s.catalogVersion).toBe(BUNDLED_CATALOG_META.catalogVersion);
    await client.close();
  });

  it('estimates tokens from text when counts are absent', async () => {
    const client = await connectClient();
    const res = await client.callTool({
      name: 'estimate_cost',
      arguments: { model: 'sonnet', inputText: 'x'.repeat(400) },
    });
    const s = structured(res);
    expect(s.inputTokens).toBe(100); /* 400 chars / 4 */
    expect(s.tokensWereEstimated).toBe(true);
    await client.close();
  });

  it('returns a structured error for an unknown model (no throw)', async () => {
    const client = await connectClient();
    const res = await client.callTool({
      name: 'estimate_cost',
      arguments: { model: 'not-a-model', inputTokens: 10, outputTokens: 10 },
    });
    expect((res as { isError?: boolean }).isError).toBe(true);
    expect(structured(res).error.code).toBe('unknown_model');
    await client.close();
  });
});

describe('predict_cost', () => {
  it('returns a cheapest-first forecast with assumptions', async () => {
    const client = await connectClient({ clientName: 'cursor' });
    const res = await client.callTool({
      name: 'predict_cost',
      arguments: { prompt: 'Summarize this diff', taskClass: 'summarise', target: 'code' },
    });
    const s = structured(res);
    expect(Array.isArray(s.forecasts)).toBe(true);
    expect(s.forecasts.length).toBeGreaterThan(0);
    expect(s.cheapest).not.toBeNull();
    /* cheapest-first ordering */
    expect(s.forecasts[0].cost.usd).toBeLessThanOrEqual(s.forecasts[1].cost.usd);
    await client.close();
  });
});

describe('select_optimal_model', () => {
  it('selects a model with reasoning and a fallbackChain', async () => {
    const client = await connectClient({ clientName: 'cursor' });
    const res = await client.callTool({
      name: 'select_optimal_model',
      arguments: {
        taskClass: 'classify_route',
        estimatedInputTokens: 800,
        estimatedOutputTokens: 20,
        target: 'code',
      },
    });
    const s = structured(res);
    expect(s.selected.model).toBe('gemini-2.5-flash-lite');
    expect(s.reasoning.length).toBeGreaterThan(0);
    expect(s.fallbackChain[0]).toBe(s.selected.model);
    await client.close();
  });

  it('classifies a free-text task via the heuristic and echoes the reason', async () => {
    const client = await connectClient({ clientName: 'cursor' });
    const res = await client.callTool({
      name: 'select_optimal_model',
      arguments: {
        task: 'classify whether this diff touches auth',
        estimatedInputTokens: 800,
        estimatedOutputTokens: 20,
        target: 'code',
      },
    });
    const s = structured(res);
    expect(s.reasoning.join(' ')).toMatch(/classif/i);
    expect(s.selected.tier).toBe('trivial');
    await client.close();
  });
});

describe('spec 5.4: client-aware scoping through the real handshake', () => {
  it('a Claude client scopes target=self to anthropic and surfaces cheaperIfAvailable', async () => {
    const client = await connectClient({ clientName: 'claude-ai' });
    const res = await client.callTool({
      name: 'select_optimal_model',
      arguments: {
        taskClass: 'summarise',
        estimatedInputTokens: 5000,
        estimatedOutputTokens: 800,
        target: 'self',
      },
    });
    const s = structured(res);
    expect(s.selected.provider).toBe('anthropic');
    expect(s.selected.model).toBe('claude-haiku-4-5-20251001');
    expect(s.scopeSource).toBe('client');
    expect(s.providerScope).toEqual(['anthropic']);
    /* The globally-cheaper gemini/openai option is surfaced honestly. */
    expect(s.cheaperIfAvailable).toBeDefined();
    expect(s.cheaperIfAvailable.provider).not.toBe('anthropic');
    await client.close();
  });

  it('the same Claude client with target=code considers all providers', async () => {
    const client = await connectClient({ clientName: 'claude-ai' });
    const res = await client.callTool({
      name: 'select_optimal_model',
      arguments: {
        taskClass: 'summarise',
        estimatedInputTokens: 5000,
        estimatedOutputTokens: 800,
        target: 'code',
      },
    });
    const s = structured(res);
    /* Unrestricted: the globally cheapest fast-or-higher model wins. */
    expect(s.selected.provider).not.toBe('anthropic');
    expect(s.cheaperIfAvailable).toBeUndefined();
    await client.close();
  });

  it('an explicit providers arg overrides the client default', async () => {
    const client = await connectClient({ clientName: 'claude-ai' });
    const res = await client.callTool({
      name: 'select_optimal_model',
      arguments: {
        taskClass: 'summarise',
        estimatedInputTokens: 5000,
        estimatedOutputTokens: 800,
        target: 'self',
        providers: ['openai'],
      },
    });
    const s = structured(res);
    expect(s.selected.provider).toBe('openai');
    expect(s.scopeSource).toBe('arg');
    await client.close();
  });
});

describe('compare_models', () => {
  it('returns a cheapest-first table with relativeToCheapest', async () => {
    const client = await connectClient({ clientName: 'cursor' });
    const res = await client.callTool({
      name: 'compare_models',
      arguments: { models: ['haiku', 'sonnet', 'opus'], inputTokens: 10000, outputTokens: 2000, target: 'code' },
    });
    const s = structured(res);
    expect(s.rows.length).toBe(3);
    expect(s.rows[0].relativeToCheapest).toBe('1.0x');
    expect(s.cheapest.model).toBe('claude-haiku-4-5-20251001');
    await client.close();
  });
});

describe('list_models / get_pricing', () => {
  it('returns the public catalog with capabilities as arrays', async () => {
    const client = await connectClient();
    const res = await client.callTool({ name: 'list_models', arguments: {} });
    const s = structured(res);
    /* Local models are excluded by default -> 10 public models. */
    expect(s.count).toBe(10);
    expect(Array.isArray(s.models[0].capabilities)).toBe(true);
    expect(s.catalogVersion).toBe(BUNDLED_CATALOG_META.catalogVersion);
    /* get_pricing is the same handler. */
    const res2 = await client.callTool({ name: 'get_pricing', arguments: { provider: 'anthropic' } });
    const s2 = structured(res2);
    expect(s2.models.every((m: any) => m.provider === 'anthropic')).toBe(true);
    await client.close();
  });
});

describe('optimize_request: worked example through the protocol', () => {
  it('opus summarise -> haiku, ~80% savings (spec Appendix C)', async () => {
    const client = await connectClient({ clientName: 'cursor' });
    const res = await client.callTool({
      name: 'optimize_request',
      arguments: { currentModel: 'opus', inputTokens: 5000, outputTokens: 800, taskClass: 'summarise', crossProvider: false },
    });
    const s = structured(res);
    expect(s.current.model).toBe('claude-opus-4-8');
    expect(s.recommended.model).toBe('claude-haiku-4-5-20251001');
    expect(s.savingsPct).toBeGreaterThan(79);
    expect(s.savingsPct).toBeLessThan(81);
    await client.close();
  });
});

describe('record_usage (opt-in)', () => {
  it('appends to a ledger and returns usdMicros when enabled', async () => {
    const client = await connectClient({ config: { ledger: true } });
    const res = await client.callTool({
      name: 'record_usage',
      arguments: { model: 'haiku', inputTokens: 1000, outputTokens: 100, label: 'test' },
    });
    const s = structured(res);
    expect(s.recorded).toBe(true);
    expect(s.costUsdMicros).toBe(1500);
    expect(typeof s.id).toBe('string');
    await client.close();
  });
});

describe('prompts and catalog resource', () => {
  it('exposes the modelcostsaver and modelcostsaver-setup prompts', async () => {
    const client = await connectClient();
    const { prompts } = await client.listPrompts();
    const names = prompts.map((p) => p.name);
    expect(names).toContain('modelcostsaver');
    expect(names).toContain('modelcostsaver-setup');
    const got = await client.getPrompt({ name: 'modelcostsaver' });
    expect(got.messages[0].content.type).toBe('text');
    await client.close();
  });

  it('serves the catalog resource as JSON with capabilities as arrays', async () => {
    const client = await connectClient();
    const read = await client.readResource({ uri: CATALOG_URI });
    const text = (read.contents[0] as { text: string }).text;
    const parsed = JSON.parse(text);
    expect(parsed.catalogVersion).toBe(BUNDLED_CATALOG_META.catalogVersion);
    expect(Array.isArray(parsed.models)).toBe(true);
    expect(Array.isArray(parsed.models[0].capabilities)).toBe(true);
    await client.close();
  });
});
