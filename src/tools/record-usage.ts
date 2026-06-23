/**
 * record_usage (spec 6.7): optional, opt-in local ledger. Appends a usage
 * record (provider, model, tokens, cost, timestamp, optional label) to a JSONL
 * file under the user config dir. OFF by default; the tool is only registered
 * when MODELCOSTSAVER_LEDGER=on. The file write is guarded and never throws into the
 * tool result. Local-only: no network, nothing leaves the machine.
 */

import { z } from 'zod';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveModel } from '../catalog/model-catalog';
import { calculateCostUsd, calculateCostMicros } from '../cost/cost-calculator';
import { configDir } from '../config/config.js';
import type { ToolContext } from '../server/context.js';
import { log } from '../server/log.js';
import { ok, fail, type ToolResult } from './shared.js';

export const LEDGER_FILENAME = 'usage.jsonl';

const inputSchema = {
  model: z.string().describe('Model alias or full id of the call that was made.'),
  inputTokens: z.number().int().nonnegative().describe('Input tokens consumed.'),
  outputTokens: z.number().int().nonnegative().describe('Output tokens produced.'),
  label: z.string().max(200).optional().describe('Optional free-text label for the record.'),
};

const outputSchema = {
  recorded: z.boolean(),
  id: z.string(),
  model: z.string(),
  provider: z.string(),
  costUsdMicros: z.number(),
  timestamp: z.string(),
  path: z.string(),
};

type RecordArgs = { model: string; inputTokens: number; outputTokens: number; label?: string };

/**
 * Register record_usage only when the ledger is enabled. With it off the tool is
 * absent from the surface, which is the honest signal that nothing is being
 * written.
 */
export function registerRecordUsageTool(server: McpServer, context: ToolContext): void {
  if (!context.config.ledger) return;

  server.registerTool(
    'record_usage',
    {
      title: 'Record usage',
      description:
        'Append a usage record to a local JSONL ledger under your config dir. Opt-in (MODELCOSTSAVER_LEDGER=on); nothing leaves the machine.',
      inputSchema,
      outputSchema,
    },
    (args: RecordArgs): ToolResult => {
      const model = resolveModel(args.model);
      if (!model) return fail(`Unknown model '${args.model}'.`, 'unknown_model');

      const { inputPerMillion, outputPerMillion } = model.pricing;
      const costUsd = calculateCostUsd(args.inputTokens, args.outputTokens, inputPerMillion, outputPerMillion);
      const costUsdMicros = calculateCostMicros(args.inputTokens, args.outputTokens, inputPerMillion, outputPerMillion);
      const id = randomUUID();
      const timestamp = new Date().toISOString();
      const dir = configDir();
      const path = join(dir, LEDGER_FILENAME);

      const record = {
        id,
        timestamp,
        provider: model.provider,
        model: model.id,
        inputTokens: args.inputTokens,
        outputTokens: args.outputTokens,
        costUsd,
        costUsdMicros,
        ...(args.label ? { label: args.label } : {}),
      };

      /* Guard the write: a ledger failure must degrade to a structured error,
         never crash the tool or corrupt the transport. */
      try {
        mkdirSync(dir, { recursive: true });
        appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf8');
      } catch (err) {
        log.warn(`failed to append usage ledger: ${(err as Error).message}`);
        return fail(`Could not write the ledger: ${(err as Error).message}`, 'ledger_write_failed');
      }

      return ok(`Recorded ${model.id} usage (${costUsdMicros} usdMicros) to the local ledger.`, {
        recorded: true,
        id,
        model: model.id,
        provider: model.provider,
        costUsdMicros,
        timestamp,
        path,
      });
    },
  );
}
