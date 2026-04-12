import { defineConfig } from 'vitest/config';
import path from 'path';

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
});
