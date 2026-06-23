import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/*
 * stdout discipline (the most common MCP packaging bug): stdout is the JSON-RPC
 * channel, so a stray write corrupts the stream. This guard asserts the shipped
 * src/ has no console.log and no process.stdout.write except the single
 * documented --version line in index.ts (which runs before any transport is
 * attached). All diagnostics must go through the stderr-only log module.
 */

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/* Strip block and line comments so a doc comment mentioning a banned token is
   not a false positive; only real code is scanned. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('stdout discipline', () => {
  const files = tsFiles(srcDir);

  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('has no console.log anywhere in src/', () => {
    const offenders = files.filter((f) => /\bconsole\.log\b/.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it('has no process.stdout.write outside the index.ts --version line', () => {
    const offenders = files.filter(
      (f) => f !== join(srcDir, 'index.ts') && /process\.stdout\.write/.test(code(f)),
    );
    expect(offenders).toEqual([]);
  });
});
