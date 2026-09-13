// ─────────────────────────────────────────────────────────────────────────────
// kv-one — main entrypoint
//
// Exports:
//   • `kv`        — auto-configured singleton (most common usage)
//   • `createKV`  — factory for custom-configured instances
//   • All public types, classes, and adapters for advanced usage
// ─────────────────────────────────────────────────────────────────────────────

export { KVClient } from './client/index.js';
export { createKV } from './client/factory.js';

// ── Adapters ─────────────────────────────────────────────────────────────────────────────
export { MemoryAdapter } from './adapters/memory.js';
export { LocalStorageAdapter } from './adapters/local-storage.js';
export { SessionStorageAdapter } from './adapters/session-storage.js';
export { CloudflareAdapter } from './adapters/cloudflare.js';
export type { CFKVNamespace, CloudflareAdapterOptions } from './adapters/cloudflare.js';
// Persistent adapters (v1.1.0)
export { IndexedDBAdapter } from './adapters/indexed-db.js';
export type { IndexedDBAdapterOptions } from './adapters/indexed-db.js';
export { NodeFileAdapter } from './adapters/node-file.js';
export type { NodeFileAdapterOptions } from './adapters/node-file.js';

// ── Core types ─────────────────────────────────────────────────────────────────────────────
export type {
  IKVAdapter,
  IKVClient,
  KVOptions,
  SetOptions,
  StoredEnvelope,
  RuntimeKind,
  // Batch operation types (v1.1.0)
  MSetItem,
  MGetResult,
  // Event subscription types (v1.1.0)
  KVEventType,
  KVEventListener,
} from './core/types.js';

// ── Errors ────────────────────────────────────────────────────────────────
export {
  KVError,
  AdapterNotFoundError,
  AdapterError,
  SerializationError,
  TTLError,
  KeyValidationError,
  UnsupportedOperationError,
} from './core/errors.js';

// ── Auto-configured singleton ─────────────────────────────────────────────

import { KVClient } from './client/index.js';

/**
 * Auto-configured KV singleton.
 *
 * The adapter is resolved lazily on first use based on the detected runtime:
 * - **Browser** → `LocalStorageAdapter` (falls back to `MemoryAdapter` in private mode)
 * - **Node.js** → `MemoryAdapter`
 * - **Cloudflare Workers** → throws `AdapterNotFoundError` (pass adapter explicitly)
 *
 * @example
 * ```ts
 * import { kv } from 'kv-one';
 *
 * await kv.set('user', { id: 1, name: 'Alice' }, { ttl: 3600 });
 * const user = await kv.get<User>('user');
 * const exists = await kv.has('user');
 * await kv.delete('user');
 * await kv.clear();
 * const keys = await kv.keys();
 *
 * // Namespacing
 * const sessionKV = kv.namespace('session');
 * await sessionKV.set('token', 'abc123', { ttl: 900 });
 * ```
 */
export const kv: KVClient = new KVClient();
