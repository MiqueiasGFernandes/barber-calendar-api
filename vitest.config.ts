import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['test/unit/**/*.spec.ts', 'test/architecture/**/*.spec.ts'],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
});
