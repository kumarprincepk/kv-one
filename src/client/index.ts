import type { IKVAdapter, IKVClient, KVOptions, SetOptions } from '../core/types.js';
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
  }

  /**
   * Delete a key.  No-op if the key does not exist.
   */
  async delete(key: string): Promise<void> {
    const sk = this.storageKey(key);
    await this.adapter.delete(sk);
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
      return;
    }

    // Namespace-scoped clear: only remove keys belonging to this prefix
    const allKeys = await this.adapter.keys();
    const prefixedKeys = allKeys.filter((k) => hasPrefix(this._prefix!, k));
    await Promise.all(prefixedKeys.map((k) => this.adapter.delete(k)));
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
}
