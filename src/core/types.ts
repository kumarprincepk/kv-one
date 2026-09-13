// ─────────────────────────────────────────────────────────────────────────────
// Core public interfaces for kv-one
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for a `set()` operation.
 */
export interface SetOptions {
  /**
   * Time-to-live in **seconds**. After this duration the key is treated as
   * if it does not exist.  Must be a positive integer.
   */
  ttl?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch operation types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single item in an `mset()` batch call.
 */
export interface MSetItem<T = unknown> {
  /** Key to store. Same validation rules as `set()`. */
  key: string;
  /** Value to store. Must be JSON-serializable. */
  value: T;
  /** Optional TTL in seconds. Same rules as `set()`. */
  ttl?: number;
}

/**
 * The result of a single key in an `mget()` call.
 */
export interface MGetResult<T = unknown> {
  key: string;
  /** The stored value, or `null` if the key is missing or expired. */
  value: T | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Event subscription types
// ─────────────────────────────────────────────────────────────────────────────

/** Events that can be subscribed to on a KVClient. */
export type KVEventType = 'set' | 'delete' | 'clear';

/**
 * Listener function signature for KV events.
 *
 * - `'set'`    → called with the public key and the newly set value
 * - `'delete'` → called with the public key; value is `undefined`
 * - `'clear'`  → called with no arguments
 */
export type KVEventListener<T = unknown> = (
  key: string | undefined,
  value: T | undefined,
) => void;

/**
 * The envelope format stored internally in every adapter.
 * Kept as an implementation detail — not part of the public API.
 */
export interface StoredEnvelope<T = unknown> {
  v: T;
  /** Unix timestamp (ms) when this entry expires, or null for no expiry. */
  exp: number | null;
}

/**
 * The low-level storage contract every adapter must fulfil.
 *
 * Adapter authors only need to implement raw read/write/delete operations;
 * TTL enforcement and serialization are handled by the core layer.
 */
export interface IKVAdapter {
  /**
   * Retrieve a raw string value previously written by {@link IKVAdapter.setRaw}.
   * Returns `null` if the key does not exist.
   */
  getRaw(key: string): Promise<string | null>;

  /**
   * Persist a raw string value.
   */
  setRaw(key: string, value: string): Promise<void>;

  /**
   * Remove a key.  Must resolve without error if the key does not exist.
   */
  delete(key: string): Promise<void>;

  /**
   * Return `true` if the key exists in the underlying store (ignoring TTL).
   */
  existsRaw(key: string): Promise<boolean>;

  /**
   * Remove every key from the underlying store.
   */
  clear(): Promise<void>;

  /**
   * Return all keys currently held in the underlying store (ignoring TTL).
   */
  keys(): Promise<string[]>;
}

/**
 * The high-level public API surface exposed to end users.
 */
export interface IKVClient {
  /**
   * Retrieve a value by key.  Returns `null` if the key does not exist or has
   * expired.
   */
  get<T = unknown>(key: string): Promise<T | null>;

  /**
   * Store a value.  Accepts an optional `ttl` (seconds) via {@link SetOptions}.
   */
  set<T = unknown>(key: string, value: T, options?: SetOptions): Promise<void>;

  /**
   * Delete a key.  Resolves without error if the key does not exist.
   */
  delete(key: string): Promise<void>;

  /**
   * Returns `true` if a non-expired entry exists for the given key.
   */
  has(key: string): Promise<boolean>;

  /**
   * Remove all keys managed by this client (respects namespace prefix).
   */
  clear(): Promise<void>;

  /**
   * Return all non-expired keys managed by this client (respects namespace).
   */
  keys(): Promise<string[]>;

  /**
   * Return all non-expired [key, value] pairs.
   */
  entries<T = unknown>(): Promise<Array<[string, T]>>;

  /**
   * Create a namespaced sub-client.  All keys will be prefixed with
   * `<prefix>:`.
   */
  namespace(prefix: string): IKVClient;

  // ── Batch operations ────────────────────────────────────────────────────

  /**
   * Set multiple key-value pairs in a single call.
   * All writes are dispatched concurrently via `Promise.all`.
   *
   * @example
   * ```ts
   * await kv.mset([
   *   { key: 'user:1', value: { name: 'Alice' } },
   *   { key: 'session', value: 'abc123', ttl: 900 },
   * ]);
   * ```
   */
  mset<T = unknown>(items: MSetItem<T>[]): Promise<void>;

  /**
   * Retrieve multiple keys in a single call.
   * Returns an array of `{ key, value }` objects in the same order as input.
   * Missing or expired keys have `value: null`.
   *
   * @example
   * ```ts
   * const results = await kv.mget<User>(['user:1', 'user:2']);
   * results.forEach(({ key, value }) => console.log(key, value));
   * ```
   */
  mget<T = unknown>(keys: string[]): Promise<MGetResult<T>[]>;

  /**
   * Delete multiple keys in a single call.
   * No-op for keys that do not exist.
   *
   * @example
   * ```ts
   * await kv.mdelete(['session', 'cache:home']);
   * ```
   */
  mdelete(keys: string[]): Promise<void>;

  // ── Event subscriptions ─────────────────────────────────────────────────

  /**
   * Subscribe to KV mutation events.
   *
   * **Events:**
   * - `'set'`    — fired after a successful `set()` or `mset()`
   * - `'delete'` — fired after a successful `delete()` or `mdelete()`
   * - `'clear'`  — fired after a successful `clear()`
   *
   * @returns An unsubscribe function — call it to remove the listener.
   *
   * @example
   * ```ts
   * const off = kv.on('set', (key, value) => {
   *   console.log(`Key set: ${key}`, value);
   * });
   * off(); // unsubscribe
   * ```
   */
  on<T = unknown>(event: KVEventType, listener: KVEventListener<T>): () => void;

  /**
   * Remove a previously registered listener.
   * If the same listener was registered multiple times, only the first
   * occurrence is removed.
   */
  off<T = unknown>(event: KVEventType, listener: KVEventListener<T>): void;
}

/**
 * Options for {@link createKV} or the global `kv` singleton.
 */
export interface KVOptions {
  /** Explicitly provide an adapter instead of auto-detecting. */
  adapter?: IKVAdapter;

  /**
   * Optional key prefix applied to **all** keys.  Useful for module isolation.
   * Do not include a trailing colon — the library appends `:` automatically.
   */
  prefix?: string;
}

/**
 * Supported runtime identifiers returned by the detector.
 */
export type RuntimeKind =
  | 'cloudflare-workers'
  | 'browser'
  | 'node'
  | 'unknown';
