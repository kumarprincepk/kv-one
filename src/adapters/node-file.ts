// ─────────────────────────────────────────────────────────────────────────────
// Node.js File Adapter
//
// Provides simple on-disk JSON persistence for Node.js environments.
// Uses only the native `node:fs/promises` and `node:path` modules.
// Zero external dependencies.
//
// Security considerations:
//   • The file path is validated: only absolute paths are accepted to prevent
//     path-traversal attacks (e.g., "../../etc/passwd").
//   • A write-lock (Promise chain) prevents concurrent writes from corrupting
//     the JSON file (Node.js is single-threaded but async I/O can interleave).
//   • File content is always parsed through the existing `safeDeserialize` path
//     (prototype-pollution guard is inherited from the serializer layer).
//   • File permissions: the file is created with mode 0o600 (owner read/write
//     only) to prevent other OS users from reading cached secrets.
//   • On parse error (corrupted file), the store resets gracefully rather than
//     throwing, preventing a bad file from permanently breaking an app.
//
// NOT compatible with: Browser, Cloudflare Workers.
// ─────────────────────────────────────────────────────────────────────────────

import { BaseAdapter } from './base.js';
import { AdapterError } from '../core/errors.js';

// Dynamic imports ensure this adapter is tree-shaken in browser/CF bundles
// and never tries to resolve `node:fs` in non-Node environments.
type FsPromises = typeof import('node:fs/promises');
type NodePath = typeof import('node:path');

export interface NodeFileAdapterOptions {
  /**
   * Absolute path to the JSON file used for persistence.
   *
   * **Must be an absolute path** — relative paths are rejected to prevent
   * path-traversal vulnerabilities.
   *
   * @example '/var/data/.kv-store.json'
   * @example 'C:\\AppData\\kv-store.json'
   */
  filePath: string;
}

export class NodeFileAdapter extends BaseAdapter {
  readonly name = 'NodeFileAdapter';

  private readonly _filePath: string;
  // Serialized write chain — prevents concurrent writes from corrupting the file
  private _writeLock: Promise<void> = Promise.resolve();

  constructor(options: NodeFileAdapterOptions) {
    super();

    if (!options.filePath || typeof options.filePath !== 'string') {
      throw new AdapterError('NodeFileAdapter requires a `filePath` option.');
    }

    // Security: only accept absolute paths to prevent path traversal
    const isAbsolute =
      options.filePath.startsWith('/') ||              // POSIX
      /^[A-Za-z]:[/\\]/.test(options.filePath);       // Windows drive letter

    if (!isAbsolute) {
      throw new AdapterError(
        `NodeFileAdapter requires an absolute file path for security reasons. ` +
          `Received: "${options.filePath}". ` +
          `Use path.resolve() or path.join(process.cwd(), ...) to create an absolute path.`,
      );
    }

    // Security: reject obvious path traversal patterns
    if (options.filePath.includes('..')) {
      throw new AdapterError(
        `NodeFileAdapter file path must not contain ".." (path traversal is not allowed). ` +
          `Received: "${options.filePath}".`,
      );
    }

    this._filePath = options.filePath;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async _getFsModules(): Promise<{ fs: FsPromises; path: NodePath }> {
    try {
      const [fs, path] = await Promise.all([
        import('node:fs/promises') as Promise<FsPromises>,
        import('node:path') as Promise<NodePath>,
      ]);
      return { fs, path };
    } catch {
      throw new AdapterError(
        'NodeFileAdapter requires Node.js. This adapter cannot be used in browser or Cloudflare Workers environments.',
      );
    }
  }

  /**
   * Load the entire store from disk into a Map.
   * On file-not-found or parse error → returns an empty Map (safe reset).
   * Prototype-pollution: uses Object.entries which does not inherit prototype.
   */
  private async _loadStore(): Promise<Map<string, string>> {
    const { fs } = await this._getFsModules();
    try {
      const content = await fs.readFile(this._filePath, { encoding: 'utf8' });

      // Parse safely: only accept a plain object at the top level
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        // Corrupted file — reset to empty
        return new Map();
      }

      // Security: reject anything that isn't a plain object
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed) ||
        Object.getPrototypeOf(parsed) !== Object.prototype
      ) {
        return new Map();
      }

      const map = new Map<string, string>();
      // Use Object.entries (not for...in) to avoid prototype chain iteration
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string') {
          map.set(k, v);
        }
      }
      return map;
    } catch (err: unknown) {
      // ENOENT = file does not exist yet — this is expected on first run
      if (
        typeof err === 'object' &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return new Map();
      }
      throw new AdapterError(`Failed to read KV store file "${this._filePath}".`, err);
    }
  }

  /**
   * Flush the given map to disk atomically using a write-lock.
   *
   * Writes to a temp file first, then renames for atomicity — prevents
   * partial writes from corrupting the store if the process crashes.
   *
   * File mode 0o600: owner read/write only (prevents other OS users from reading).
   */
  private _saveStore(store: Map<string, string>): Promise<void> {
    this._writeLock = this._writeLock.then(async () => {
      const { fs, path } = await this._getFsModules();
      const dir = path.dirname(this._filePath);
      const tmpPath = `${this._filePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Serialize using plain Object.fromEntries — no prototype issues
      const data = JSON.stringify(Object.fromEntries(store), null, 2);

      try {
        // Ensure the parent directory exists
        await fs.mkdir(dir, { recursive: true });
        // Write to temp file first
        await fs.writeFile(tmpPath, data, { encoding: 'utf8', mode: 0o600 });
        // Atomic rename — if process crashes before this, tmpPath is orphaned,
        // original file is untouched.
        await fs.rename(tmpPath, this._filePath);
      } catch (err) {
        // Clean up temp file on failure (best-effort)
        await fs.unlink(tmpPath).catch(() => undefined);
        throw new AdapterError(`Failed to write KV store file "${this._filePath}".`, err);
      }
    });
    return this._writeLock;
  }

  // ── IKVAdapter implementation ─────────────────────────────────────────────

  async getRaw(key: string): Promise<string | null> {
    const store = await this._loadStore();
    return store.get(key) ?? null;
  }

  async setRaw(key: string, value: string): Promise<void> {
    const store = await this._loadStore();
    store.set(key, value);
    await this._saveStore(store);
  }

  async delete(key: string): Promise<void> {
    const store = await this._loadStore();
    if (store.delete(key)) {
      await this._saveStore(store);
    }
  }

  async existsRaw(key: string): Promise<boolean> {
    const store = await this._loadStore();
    return store.has(key);
  }

  async clear(): Promise<void> {
    await this._saveStore(new Map());
  }

  async keys(): Promise<string[]> {
    const store = await this._loadStore();
    return Array.from(store.keys());
  }
}
