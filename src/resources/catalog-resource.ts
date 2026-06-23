/**
 * MCP resource (spec 6.9): expose the pricing catalog at modelcostsaver://catalog
 * as inspectable JSON (capabilities as arrays, includes catalogVersion, asOf,
 * source). Lets a client read the full price list without a tool call.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildCatalogPayload } from '../catalog/serialize';
import type { ToolContext } from '../server/context.js';

export const CATALOG_URI = 'modelcostsaver://catalog';

export function registerCatalogResource(server: McpServer, context: ToolContext): void {
  server.registerResource(
    'catalog',
    CATALOG_URI,
    {
      title: 'ModelCostSaver pricing catalog',
      description: 'The full model catalog with per-token pricing, tiers, and capabilities. Offline, versioned.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const payload = buildCatalogPayload(context.catalogMeta);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  );
}
