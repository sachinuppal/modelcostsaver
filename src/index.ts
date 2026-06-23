/**
 * ModelCostSaver MCP entry point and argv router.
 *
 *   modelcostsaver            start the MCP stdio server (default)
 *   modelcostsaver serve      start the MCP stdio server (explicit)
 *   modelcostsaver install    write the IDE MCP config (see cli/install)
 *   modelcostsaver setup      first-run helper (see cli/setup)
 *   modelcostsaver --version  print the version
 *
 * stdout is reserved for the JSON-RPC channel once the server is serving; only
 * --version writes to stdout (a single line, before any transport is attached).
 * All other diagnostics go to stderr.
 */

import { serve, SERVER_VERSION } from './server/server.js';
import { log } from './server/log.js';

async function main(argv: string[]): Promise<void> {
  const command = argv[0];

  if (command === '--version' || command === '-v') {
    process.stdout.write(`${SERVER_VERSION}\n`);
    return;
  }

  if (command === 'install') {
    const { runInstallCli } = await import('./cli/install.js');
    await runInstallCli(argv.slice(1));
    return;
  }

  if (command === 'setup' || command === 'login') {
    const { runSetup } = await import('./cli/setup.js');
    await runSetup();
    return;
  }

  /* Default (no command) and explicit 'serve' both start the server. */
  if (command === undefined || command === 'serve') {
    await serve();
    return;
  }

  log.error(`unknown command '${command}'. Use: serve | install | setup | --version`);
  process.exitCode = 1;
}

main(process.argv.slice(2)).catch((err) => {
  log.error(`fatal: ${(err as Error).message}`);
  process.exit(1);
});
