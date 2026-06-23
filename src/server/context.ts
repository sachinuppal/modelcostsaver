/**
 * Tool execution context.
 *
 * Carries the resolved configuration and a late-bound accessor for the connected
 * client's name (read from the MCP initialize handshake's clientInfo.name). The
 * client name is not known at construction time, so tools read it through the
 * accessor at call time to derive the default provider availability scope.
 */

import type { ResolvedConfig } from '../config/config.js';
import type { CatalogMeta } from '../catalog/meta.js';

export interface ToolContext {
  config: ResolvedConfig;
  /** Active catalog provenance, echoed on every cost-bearing result. */
  catalogMeta: CatalogMeta;
  /** clientInfo.name from initialize, or undefined before the handshake. */
  getClientName(): string | undefined;
}
