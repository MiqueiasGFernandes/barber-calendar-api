import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export default defineConfig({ resolve: { alias: {
  '#scheduling': resolve(fileURLToPath(new URL('.', import.meta.url)), 'src/modules/scheduling'),
  '#audit': resolve(fileURLToPath(new URL('.', import.meta.url)), 'src/modules/audit'),
} }, test: { include: ['test/contract/**/*.spec.ts'] } });
