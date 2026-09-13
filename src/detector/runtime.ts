import type { RuntimeKind } from '../core/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Runtime Detection
//
// Detection is lazy — performed once and cached.
// Priority chain (first match wins):
//   1. Cloudflare Workers
//   2. Browser (with localStorage)
//   3. Node.js
//   4. Unknown / fallback
// ─────────────────────────────────────────────────────────────────────────────

let cachedRuntime: RuntimeKind | null = null;

/**
 * Detect the current JavaScript runtime.
 *
 * Detection result is memoized after the first call.
 */
export function detectRuntime(): RuntimeKind {
  if (cachedRuntime !== null) return cachedRuntime;
  cachedRuntime = detectRuntimeUncached();
  return cachedRuntime;
}

/**
 * Reset the cached runtime detection result.
 * **For testing purposes only.**
 */
export function _resetRuntimeCache(): void {
  cachedRuntime = null;
}

function detectRuntimeUncached(): RuntimeKind {
  // ── 1. Cloudflare Workers ─────────────────────────────────────────────────
  // CF Workers expose a global `caches` API and `fetch` but intentionally
  // omit `process` and `window`.
  if (
    typeof globalThis !== 'undefined' &&
    // CF Workers have WebCache API
    typeof (globalThis as Record<string, unknown>)['caches'] !== 'undefined' &&
    typeof fetch !== 'undefined' &&
    // Exclude Node.js (which also has fetch since v18)
    typeof (globalThis as Record<string, unknown>)['process'] === 'undefined' &&
    // Exclude browsers (which have `window`)
    typeof (globalThis as Record<string, unknown>)['window'] === 'undefined'
  ) {
    return 'cloudflare-workers';
  }

  // ── 2. Browser ────────────────────────────────────────────────────────────
  if (
    typeof window !== 'undefined' &&
    typeof window.localStorage !== 'undefined'
  ) {
    return 'browser';
  }

  // ── 3. Node.js ────────────────────────────────────────────────────────────
  if (
    typeof process !== 'undefined' &&
    process.versions !== null &&
    process.versions.node !== null
  ) {
    return 'node';
  }

  // ── 4. Unknown fallback ───────────────────────────────────────────────────
  return 'unknown';
}
