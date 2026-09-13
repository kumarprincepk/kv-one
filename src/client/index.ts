import type { IKVAdapter, IKVClient, KVOptions, SetOptions, MSetItem, MGetResult, KVEventType, KVEventListener } from '../core/types.js';
import { AdapterNotFoundError } from '../core/errors.js';
import { deserializeEnvelope, serializeEnvelope } from '../core/serializer.js';
import { isExpired, ttlToExpiry, validateTTL } from '../core/ttl.js';
import {
  applyPrefix,
  hasPrefix,
  stripPrefix,
  validateKey,
} from '../core/namespace.js';
import { detectRuntime } from '../detector/runtime.js';
import { MemoryAdapter } from '../adapters/memory.js';
import { LocalStorageAdapter } from '../adapters/local-storage.js';

// ─────────────────────────────────────────────────────────────────────────────
// Auto-adapter factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build and return the most appropriate adapter for the current runtime.
 * Called lazily by `KVClient` on first use when no adapter is provided.
 */
function buildDefaultAdapter(): IKVAdapter {
  const runtime = detectRuntime();

  switch (runtime) {
    case 'browser':
      try {
        return new LocalStorageAdapter();
      } catch {
        // localStorage unavailable (private mode, iframe sandbox, etc.)
        // Degrade gracefully to in-memory store
        return new MemoryAdapter();
      }

    case 'node':
    case 'unknown':
      return new MemoryAdapter();

    case 'cloudflare-workers':
      throw new AdapterNotFoundError(runtime);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// KVClient
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The primary API surface for `kv-one`.
 *
 * **TTL enforcement** lives entirely here — adapters store raw strings and
 * know nothing about expiry.  Every stored value is wrapped in a
 * `StoredEnvelope { v, exp }` JSON string.
 *
 * @example
 * ```ts
 * // Auto-configured singleton
 * import { kv } from 'kv-one';
 * await kv.set('user', { name: 'Alice' }, { ttl: 3600 });
 * const user = await kv.get<User>('user');
 *
 * // Namespaced sub-client
 * const sessionKV = kv.namespace('session');
 * await sessionKV.set('token', 'abc123', { ttl: 900 });
 * ```
 */
export class KVClient implements IKVClient {
  private _adapter: IKVAdapter | null;
  private readonly _prefix: string | null;

  // ── Event emitter state ───────────────────────────────────────────────────
  // Stored as a plain Map<string, Function[]> — never using Object as a map
  // to prevent prototype-pollution on the listener registry.
  // Max 100 listeners per event type to guard against accidental memory leaks.
  private static readonly _MAX_LISTENERS = 100;
  private readonly _listeners: Map<KVEventType, KVEventListener[]> = new Map();

  /**
   * @param options - Optional configuration.  If `adapter` is not supplied the
   *   adapter is resolved lazily from the detected runtime on first use.
   */
  constructor(options: KVOptions = {}) {
    this._adapter = options.adapter ?? null;
    this._prefix = options.prefix ?? null;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private get adapter(): IKVAdapter {
    if (this._adapter === null) {
      this._adapter = buildDefaultAdapter();
    }
    return this._adapter;
  }

  /**
   * Build the storage key, applying namespace prefix when set.
   */
  private storageKey(key: string): string {
    validateKey(key);
    return this._prefix !== null ? applyPrefix(this._prefix, key) : key;
  }

  /**
   * Strip the namespace prefix from a raw storage key to expose the public key.
   */
  private publicKey(storageKey: string): string {
    if (this._prefix !== null) {
      return stripPrefix(this._prefix, storageKey);
    }
    return storageKey;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Retrieve a value by key.
   *
   * Returns `null` if:
   * - The key does not exist
   * - The stored entry has expired (TTL elapsed)
   *
   * Expired entries are lazily deleted on read.
   */
  async get<T = unknown>(key: string): Promise<T | null> {
    const sk = this.storageKey(key);
    const raw = await this.adapter.getRaw(sk);

    if (raw === null) return null;

    const envelope = deserializeEnvelope<T>(raw);

    if (isExpired(envelope.exp)) {
      // Lazy expiry — delete on read
      await this.adapter.delete(sk).catch(() => {
        // Best-effort — ignore delete errors during lazy cleanup
      });
      return null;
    }

    return envelope.v;
  }

  /**
   * Store a value, optionally with a TTL.
   *
   * @param key - Must match `/^[a-zA-Z0-9\-_:.]+$/`
   * @param value - Must be JSON-serializable
   * @param options - Optional `{ ttl: number }` (seconds)
   */
  async set<T = unknown>(key: string, value: T, options?: SetOptions): Promise<void> {
    const sk = this.storageKey(key);

    if (options?.ttl !== undefined) {
      validateTTL(options.ttl);
    }

    const expiresAt = ttlToExpiry(options?.ttl);
    const raw = serializeEnvelope(value, expiresAt);
    await this.adapter.setRaw(sk, raw);
    // Emit event after successful write
    this._emit<T>('set', key, value);
  }

  /**
   * Delete a key.  No-op if the key does not exist.
   */
  async delete(key: string): Promise<void> {
    const sk = this.storageKey(key);
    await this.adapter.delete(sk);
    // Emit event after successful delete
    this._emit('delete', key, undefined);
  }

  /**
   * Returns `true` if a non-expired entry exists for `key`.
   */
  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  /**
   * Remove all keys managed by this client.
   *
   * When a namespace prefix is active, only keys with that prefix are removed.
   * When no prefix is active, **all** keys in the underlying adapter are cleared.
   */
  async clear(): Promise<void> {
    if (this._prefix === null) {
      await this.adapter.clear();
      this._emit('clear', undefined, undefined);
      return;
    }

    // Namespace-scoped clear: only remove keys belonging to this prefix
    const allKeys = await this.adapter.keys();
    const prefixedKeys = allKeys.filter((k) => hasPrefix(this._prefix!, k));
    await Promise.all(prefixedKeys.map((k) => this.adapter.delete(k)));
    this._emit('clear', undefined, undefined);
  }

  /**
   * Return all **non-expired** keys managed by this client.
   * Keys are returned without the namespace prefix.
   */
  async keys(): Promise<string[]> {
    const allKeys = await this.adapter.keys();
    const relevantKeys = this._prefix !== null
      ? allKeys.filter((k) => hasPrefix(this._prefix!, k))
      : allKeys;

    // Filter expired keys (reads each value — intentional for correctness)
    const result: string[] = [];
    for (const sk of relevantKeys) {
      const raw = await this.adapter.getRaw(sk);
      if (raw === null) continue;

      try {
        const envelope = deserializeEnvelope(raw);
        if (!isExpired(envelope.exp)) {
          result.push(this.publicKey(sk));
        }
      } catch {
        // Skip corrupted entries
      }
    }

    return result;
  }

  /**
   * Return all non-expired `[key, value]` pairs.
   * Keys are returned without the namespace prefix.
   */
  async entries<T = unknown>(): Promise<Array<[string, T]>> {
    const allKeys = await this.adapter.keys();
    const relevantKeys = this._prefix !== null
      ? allKeys.filter((k) => hasPrefix(this._prefix!, k))
      : allKeys;

    const result: Array<[string, T]> = [];

    for (const sk of relevantKeys) {
      const raw = await this.adapter.getRaw(sk);
      if (raw === null) continue;

      try {
        const envelope = deserializeEnvelope<T>(raw);
        if (!isExpired(envelope.exp)) {
          result.push([this.publicKey(sk), envelope.v]);
        }
      } catch {
        // Skip corrupted entries
      }
    }

    return result;
  }

  /**
   * Create a namespaced sub-client.
   *
   * All keys will be automatically prefixed with `<prefix>:`.
   * The sub-client shares the same adapter instance.
   *
   * @example
   * ```ts
   * const userKV = kv.namespace('users');
   * await userKV.set('alice', { role: 'admin' });
   * // Stored internally as "users:alice"
   * ```
   */
  namespace(prefix: string): KVClient {
    validateKey(prefix);
    const combinedPrefix = this._prefix !== null
      ? `${this._prefix}:${prefix}`
      : prefix;

    return new KVClient({
      adapter: this.adapter,
      prefix: combinedPrefix,
    });
  }

  // ── Batch operations ─────────────────────────────────────────────────────

  /**
   * Set multiple key-value pairs concurrently.
   *
   * Security: each key and TTL is validated individually through the existing
   * `set()` path — no bypass of the key validator or TTL validator.
   */
  async mset<T = unknown>(items: MSetItem<T>[]): Promise<void> {
    if (!Array.isArray(items)) {
      throw new TypeError('mset() expects an array of { key, value, ttl? } items.');
    }
    await Promise.all(
      items.map((item) =>
        this.set(item.key, item.value, item.ttl !== undefined ? { ttl: item.ttl } : undefined),
      ),
    );
  }

  /**
   * Retrieve multiple keys concurrently.
   * Results are returned in the same order as the input keys.
   *
   * Security: each key is validated through the existing `get()` path.
   * An invalid key resolves to `{ key, value: null }` instead of throwing,
   * so one bad key does not abort the whole batch.
   */
  async mget<T = unknown>(keys: string[]): Promise<MGetResult<T>[]> {
    if (!Array.isArray(keys)) {
      throw new TypeError('mget() expects an array of key strings.');
    }
    return Promise.all(
      keys.map(async (key) => {
        try {
          const value = await this.get<T>(key);
          return { key, value };
        } catch {
          // Key validation failure — return null rather than crashing the batch
          return { key, value: null };
        }
      }),
    );
  }

  /**
   * Delete multiple keys concurrently.
   * No-op for keys that do not exist.
   *
   * Security: each key is validated through the existing `delete()` path.
   */
  async mdelete(keys: string[]): Promise<void> {
    if (!Array.isArray(keys)) {
      throw new TypeError('mdelete() expects an array of key strings.');
    }
    await Promise.all(
      keys.map(async (key) => {
        try {
          await this.delete(key);
        } catch {
          // Best-effort: skip invalid keys in a batch delete
        }
      }),
    );
  }

  // ── Event subscriptions ──────────────────────────────────────────────────

  /**
   * Internal helper: emit an event to all registered listeners.
   * Listeners are called synchronously in registration order.
   * Errors thrown inside a listener are caught and logged — one bad listener
   * must never break the store operation that triggered it.
   */
  private _emit<T = unknown>(
    event: KVEventType,
    key: string | undefined,
    value: T | undefined,
  ): void {
    const listeners = this._listeners.get(event);
    if (!listeners || listeners.length === 0) return;

    // Snapshot the array before iterating so mid-emit `off()` calls are safe
    const snapshot = listeners.slice();
    for (const listener of snapshot) {
      try {
        listener(key, value);
      } catch (err) {
        // Never let a listener crash the store
        if (typeof console !== 'undefined') {
          console.error(`[kv-one] Uncaught error in "${event}" listener:`, err); // eslint-disable-line no-console
        }
      }
    }
  }

  /**
   * Subscribe to a KV mutation event.
   * Returns an unsubscribe function for convenient cleanup.
   *
   * Security:
   * - Listener count is capped at 100 per event type to prevent memory leaks.
   * - Listener errors are caught and never propagate to the calling operation.
   */
  on<T = unknown>(event: KVEventType, listener: KVEventListener<T>): () => void {
    if (typeof listener !== 'function') {
      throw new TypeError('kv.on() listener must be a function.');
    }
    const validEvents: KVEventType[] = ['set', 'delete', 'clear'];
    if (!validEvents.includes(event)) {
      throw new TypeError(
        `kv.on() received unknown event "${String(event)}". Valid events: ${validEvents.join(', ')}.`,
      );
    }

    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    const list = this._listeners.get(event)!;

    if (list.length >= KVClient._MAX_LISTENERS) {
      if (typeof console !== 'undefined') {
        console.warn( // eslint-disable-line no-console
          `[kv-one] Possible memory leak: more than ${KVClient._MAX_LISTENERS} "${event}" listeners registered.`,
        );
      }
    }

    list.push(listener as KVEventListener);
    // Return a one-shot unsubscribe function
    return () => this.off(event, listener);
  }

  /**
   * Remove a previously registered listener.
   * Only the first matching reference is removed (supports multiple identical registrations).
   */
  off<T = unknown>(event: KVEventType, listener: KVEventListener<T>): void {
    const list = this._listeners.get(event);
    if (!list) return;
    const idx = list.indexOf(listener as KVEventListener);
    if (idx !== -1) {
      list.splice(idx, 1);
    }
  }
}
