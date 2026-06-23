/**
 * stderr-only logger.
 *
 * stdout is reserved for the JSON-RPC channel: a single stray byte on stdout
 * corrupts the MCP stream and is the most common MCP packaging bug. Every
 * diagnostic line written by this server goes to process.stderr and nowhere
 * else. There are deliberately no console.* calls and no writes to the standard
 * output stream in this module or its callers; the only writer of stdout is the
 * SDK transport.
 */

const PREFIX = '[modelcostsaver]';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

function write(level: LogLevel, message: string): void {
  process.stderr.write(`${PREFIX} ${level}: ${message}\n`);
}

export const log = {
  info(message: string): void {
    write('info', message);
  },
  warn(message: string): void {
    write('warn', message);
  },
  error(message: string): void {
    write('error', message);
  },
  /** Emitted only when MODELCOSTSAVER_DEBUG is set to a truthy value. */
  debug(message: string): void {
    if (process.env.MODELCOSTSAVER_DEBUG && process.env.MODELCOSTSAVER_DEBUG !== 'off') {
      write('debug', message);
    }
  },
};
