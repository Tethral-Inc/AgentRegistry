import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import path from 'path';

// Mirror esbuild's build-time constant so mcp-server modules imported
// from tests (e.g. createAcrServer) can read their own package version.
const mcpServerVersion = JSON.parse(
  readFileSync(path.resolve(__dirname, 'packages/mcp-server/package.json'), 'utf8'),
).version as string;

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    root: path.resolve(__dirname),
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@acr/shared': path.resolve(__dirname, 'shared'),
    },
  },
  define: {
    __PACKAGE_VERSION__: JSON.stringify(mcpServerVersion),
  },
});
