import { BaseAdapter } from './base.js';
import { AdapterError } from '../core/errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// IndexedDB Adapter
//
// Provides persistent, async, quota-friendly storage for browser environments.
// Uses the native IndexedDB API — zero external dependencies.
//
// Security considerations:
//   • All keys are strings; no key is ever eval'd or used as a prototype prop.
//   • The store name is validated to prevent injection into the IDBOpenDBRequest.
//   • Errors from IDB are always surfaced as typed AdapterError, never silent.
//   • The database is opened with a single object store; no cursor is left open
//     longer than needed to prevent resource leaks.
//
// Compatibility: All modern browsers. Not available in Node.js or CF Workers.
// ─────────────────────────────────────────────────────────────────────────────

/** Valid IndexedDB store name: alphanumeric, hyphens, underscores only */
const STORE_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const DEFAULT_DB_NAME = 'kv-one';
const DEFAULT_STORE_NAME = 'kv';
const DB_VERSION = 1;

export interface IndexedDBAdapterOptions {
  /**
   * Name of the IndexedDB database.
   * Must match `/^[a-zA-Z0-9_-]+$/`.
   * @default 'kv-one'
   */
  dbName?: string;

  /**
   * Name of the object store inside the database.
   * Must match `/^[a-zA-Z0-9_-]+$/`.
   * @default 'kv'
   */
  storeName?: string;
}

export class IndexedDBAdapter extends BaseAdapter {
  readonly name = 'IndexedDBAdapter';

  private readonly _dbName: string;
  private readonly _storeName: string;
  private _dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDBAdapterOptions = {}) {
    super();

    // Validate names to prevent any injection or weird IDB behaviour
    const dbName = options.dbName ?? DEFAULT_DB_NAME;
    const storeName = options.storeName ?? DEFAULT_STORE_NAME;

    if (!STORE_NAME_RE.test(dbName)) {
      throw new AdapterError(
        `IndexedDB database name "${dbName}" is invalid. Use only alphanumeric characters, hyphens, or underscores.`,
      );
    }
    if (!STORE_NAME_RE.test(storeName)) {
      throw new AdapterError(
        `IndexedDB store name "${storeName}" is invalid. Use only alphanumeric characters, hyphens, or underscores.`,
      );
    }

    this._dbName = dbName;
    this._storeName = storeName;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Open (and cache) the IDB connection. Called lazily on first operation.
   * Connection is reused for the lifetime of the adapter instance.
   */
  private openDB(): Promise<IDBDatabase> {
    if (this._dbPromise !== null) return this._dbPromise;

    this._dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(
          new AdapterError(
            'IndexedDB is not available in this environment. Use LocalStorageAdapter or MemoryAdapter instead.',
          ),
        );
        return;
      }

      const request = indexedDB.open(this._dbName, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this._storeName)) {
          db.createObjectStore(this._storeName);
        }
      };

      request.onsuccess = (event) => {
        resolve((event.target as IDBOpenDBRequest).result);
      };

      request.onerror = (event) => {
        // Reset so next call retries
        this._dbPromise = null;
        reject(
          new AdapterError(
            `Failed to open IndexedDB database "${this._dbName}".`,
            (event.target as IDBOpenDBRequest).error ?? undefined,
          ),
        );
      };

      request.onblocked = () => {
        this._dbPromise = null;
        reject(
          new AdapterError(
            `IndexedDB database "${this._dbName}" is blocked by another connection. Close other tabs and retry.`,
          ),
        );
      };
    });

    return this._dbPromise;
  }

  /**
   * Execute an IDB request inside a transaction and resolve/reject the promise.
   * The transaction is opened fresh per operation — no shared transaction state.
   */
  private async withStore<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.openDB();
    return new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(this._storeName, mode);
      } catch (err) {
        reject(new AdapterError('Failed to open IndexedDB transaction.', err));
        return;
      }

      tx.onerror = (event) => {
        reject(
          new AdapterError(
            'IndexedDB transaction failed.',
            (event.target as IDBTransaction).error ?? undefined,
          ),
        );
      };

      let req: IDBRequest<T>;
      try {
        const store = tx.objectStore(this._storeName);
        req = operation(store);
      } catch (err) {
        reject(new AdapterError('IndexedDB operation failed.', err));
        return;
      }

      req.onsuccess = (event) => {
        resolve((event.target as IDBRequest<T>).result);
      };

      req.onerror = (event) => {
        reject(
          new AdapterError(
            'IndexedDB request failed.',
            (event.target as IDBRequest).error ?? undefined,
          ),
        );
      };
    });
  }

  // ── IKVAdapter implementation ─────────────────────────────────────────────

  async getRaw(key: string): Promise<string | null> {
    const result = await this.withStore<string | undefined>('readonly', (store) =>
      store.get(key),
    );
    return result ?? null;
  }

  async setRaw(key: string, value: string): Promise<void> {
    await this.withStore<IDBValidKey>('readwrite', (store) => store.put(value, key));
  }

  async delete(key: string): Promise<void> {
    await this.withStore<undefined>('readwrite', (store) => store.delete(key));
  }

  async existsRaw(key: string): Promise<boolean> {
    const result = await this.withStore<IDBValidKey | undefined>('readonly', (store) =>
      store.getKey(key),
    );
    return result !== undefined;
  }

  async clear(): Promise<void> {
    await this.withStore<undefined>('readwrite', (store) => store.clear());
  }

  async keys(): Promise<string[]> {
    const result = await this.withStore<IDBValidKey[]>('readonly', (store) =>
      store.getAllKeys(),
    );
    // IDB keys from our store are always strings — filter defensively
    return result.filter((k): k is string => typeof k === 'string');
  }

  /**
   * Close the underlying database connection.
   * Call this when you are completely done with the adapter to free resources.
   */
  async close(): Promise<void> {
    if (this._dbPromise !== null) {
      const db = await this._dbPromise;
      db.close();
      this._dbPromise = null;
    }
  }
}
