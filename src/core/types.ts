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
