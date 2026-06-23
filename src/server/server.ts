/**
 * MCP server construction and wiring.
 *
 * Builds an McpServer, sets the server-level instructions, registers the cost
 * tools, the cost-discipline prompts, and the catalog resource, captures the
 * connecting client's name from the initialize handshake (for spec 5.4 provider
 * scoping), connects the stdio transport, and installs graceful shutdown.
 *
 * stdout is owned exclusively by the transport; all diagnostics go to stderr via
 * the log module.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import { log } from './log.js';
import type { ToolContext } from './context.js';
import { loadConfig } from '../config/config.js';
import { loadActiveCatalogMeta, resolveActiveCatalogMeta } from '../catalog/load.js';
import type { CatalogMeta } from '../catalog/meta.js';
import { registerTools } from '../tools/register.js';
import { registerPrompts } from '../prompts/cost-aware.js';
import { registerCatalogResource } from '../resources/catalog-resource.js';

export const SERVER_NAME = 'modelcostsaver';
export const SERVER_VERSION = '0.1.0';

/**
 * Construct the McpServer with all tools, prompts, and the catalog resource
 * registered. The client name is read lazily from the underlying Server's
 * recorded clientInfo so tool handlers can derive the default provider scope at
 * call time (it is unknown until the initialize handshake completes).
 */
export function buildServer(catalogMeta?: CatalogMeta): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  const config = loadConfig();
  /* Default to the synchronous bundled provenance; serve() passes a refreshed
     meta when MODELCOSTSAVER_REFRESH is on. */
  const meta = catalogMeta ?? loadActiveCatalogMeta(config);

  const context: ToolContext = {
    config,
    catalogMeta: meta,
    getClientName: () => server.server.getClientVersion()?.name,
  };

  registerTools(server, context);
  registerPrompts(server);
  registerCatalogResource(server, context);

  return server;
}

/** Build, connect over stdio, and run the server until a shutdown signal. */
export async function serve(): Promise<void> {
  /* Resolve provenance honoring the opt-in refresh before any transport is
     attached. With refresh off this is the offline bundled metadata; with it on
     it reflects the freshest valid source, falling back to bundled on failure. */
  const meta = await resolveActiveCatalogMeta(loadConfig());
  const server = buildServer(meta);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info(`ready (stdio). ${SERVER_NAME} ${SERVER_VERSION}`);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`received ${signal}; shutting down.`);
    try {
      await server.close();
    } catch (err) {
      log.error(`error during shutdown: ${(err as Error).message}`);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
