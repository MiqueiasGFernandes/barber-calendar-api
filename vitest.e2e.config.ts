import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export default defineConfig({
  resolve: { alias: {
    '#scheduling': resolve(fileURLToPath(new URL('.', import.meta.url)), 'src/modules/scheduling'),
    '#audit': resolve(fileURLToPath(new URL('.', import.meta.url)), 'src/modules/audit'),
  } },
  test: {
    include: ['test/e2e/**/*.e2e-spec.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
