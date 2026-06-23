import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  sourcemap: false,
  dts: false,
  /* Bundle dependencies so npx cold-start needs no install step beyond the two
     runtime deps; keeps the published artifact self-contained. */
  noExternal: ['@modelcontextprotocol/sdk', 'zod'],
});
