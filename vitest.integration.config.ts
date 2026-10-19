import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export default defineConfig({
  resolve: { alias: {
    '#scheduling': resolve(fileURLToPath(new URL('.', import.meta.url)), 'src/modules/scheduling'),
    '#audit': resolve(fileURLToPath(new URL('.', import.meta.url)), 'src/modules/audit'),
  } },
  test: {
    include: ['test/integration/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
