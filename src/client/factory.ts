import { KVClient } from './index.js';
import type { KVOptions } from '../core/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// createKV factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new, independently configured `KVClient` instance.
 *
 * Use this instead of the global `kv` singleton when you need:
 * - A specific adapter (e.g., `CloudflareAdapter` in Workers)
 * - A different default prefix
 * - Isolated test instances
 *
 * @example
 * ```ts
 * import { createKV, CloudflareAdapter } from 'kv-one';
 *
 * // In a Cloudflare Worker:
 * const store = createKV({ adapter: new CloudflareAdapter({ namespace: env.MY_KV }) });
 * await store.set('hello', 'world');
 * ```
 *
 * @example
 * ```ts
 * import { createKV, MemoryAdapter } from 'kv-one';
 *
 * // In tests:
 * const store = createKV({ adapter: new MemoryAdapter() });
 * ```
 */
export function createKV(options?: KVOptions): KVClient {
  return new KVClient(options);
}
