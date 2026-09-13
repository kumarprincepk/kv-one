import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { detectRuntime, _resetRuntimeCache } from '../../src/detector/runtime';

// Helpers to mock the global environment
function mockBrowser() {
  vi.stubGlobal('window', {
    localStorage: {
      setItem: vi.fn(),
      removeItem: vi.fn(),
    },
  });
}

function mockNode() {
  vi.stubGlobal('window', undefined);
  vi.stubGlobal('process', {
    versions: { node: '20.0.0' },
  });
}

function mockCloudflarWorker() {
  vi.stubGlobal('window', undefined);
  vi.stubGlobal('process', undefined);
  vi.stubGlobal('caches', { default: {} });
  vi.stubGlobal('fetch', vi.fn());
}

function mockUnknown() {
  vi.stubGlobal('window', undefined);
  vi.stubGlobal('process', undefined);
  vi.stubGlobal('caches', undefined);
  vi.stubGlobal('fetch', undefined);
}

describe('detectRuntime()', () => {
  beforeEach(() => {
    _resetRuntimeCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _resetRuntimeCache();
  });

  it('detects browser when window.localStorage is available', () => {
    mockBrowser();
    expect(detectRuntime()).toBe('browser');
  });

  it('detects node when process.versions.node is present', () => {
    mockNode();
    expect(detectRuntime()).toBe('node');
  });

  it('detects cloudflare-workers when caches + fetch present, no window/process', () => {
    mockCloudflarWorker();
    expect(detectRuntime()).toBe('cloudflare-workers');
  });

  it('returns "unknown" when no runtime signals are present', () => {
    mockUnknown();
    expect(detectRuntime()).toBe('unknown');
  });

  it('caches the result after first call', () => {
    mockNode();
    const first = detectRuntime();
    // Change the environment — but cache should return stale value
    vi.stubGlobal('window', { localStorage: {} });
    const second = detectRuntime();
    expect(first).toBe(second);
    expect(second).toBe('node');
  });

  it('re-detects after cache reset', () => {
    mockNode();
    expect(detectRuntime()).toBe('node');
    _resetRuntimeCache();
    mockBrowser();
    expect(detectRuntime()).toBe('browser');
  });
});
