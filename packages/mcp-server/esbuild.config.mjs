import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'));

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  external: ['node:*'],
  sourcemap: false,
  minify: false,
  define: { __PACKAGE_VERSION__: JSON.stringify(version) },
};

// Stdio entry (the one npx users run)
await build({ ...shared, entryPoints: ['src/index.ts'], outfile: 'dist/index.mjs' });

// HTTP entry
await build({ ...shared, entryPoints: ['src/http.ts'], outfile: 'dist/http.mjs' });
