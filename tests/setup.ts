import { beforeEach, afterEach, vi } from 'vitest';

// Global test setup
// This file is referenced by vitest.config.ts `setupFiles`

// Silence console.warn in tests unless explicitly checked
// (adapters may emit warnings for quota errors etc.)
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});
