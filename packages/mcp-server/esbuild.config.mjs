import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  external: ['node:*'],
  sourcemap: true,
  minify: false,
};

// Stdio entry (the one npx users run)
await build({ ...shared, entryPoints: ['src/index.ts'], outfile: 'dist/index.mjs' });

// HTTP entry
await build({ ...shared, entryPoints: ['src/http.ts'], outfile: 'dist/http.mjs' });
