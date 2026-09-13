import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    environmentMatchGlobs: [
      // Use jsdom for localStorage-related tests
      ['tests/unit/adapters/local-storage.test.ts', 'jsdom'],
      ['tests/unit/adapters/session-storage.test.ts', 'jsdom'],
      ['tests/integration/**', 'jsdom'],
    ],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
  resolve: {
    conditions: ['import', 'module', 'browser', 'default'],
  },
});
