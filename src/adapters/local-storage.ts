import { AdapterError } from '../core/errors.js';
import { BaseAdapter } from './base.js';

// ─────────────────────────────────────────────────────────────────────────────
// localStorage Adapter (Browser)
//
// Wraps window.localStorage with:
//   • Graceful degradation when localStorage is unavailable (private mode,
//     sandboxed iframes, storage disabled in settings)
//   • Proper QuotaExceededError handling surfaced as AdapterError
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns `true` if `localStorage` is accessible in the current environment.
 * Avoids throwing during SSR by checking for `window` first.
 */
function isLocalStorageAvailable(): boolean {
  try {
    const testKey = '__ukv_test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

export class LocalStorageAdapter extends BaseAdapter {
  readonly name = 'LocalStorageAdapter';

  private readonly storage: Storage;

  constructor() {
    super();
    if (typeof window === 'undefined' || !isLocalStorageAvailable()) {
      throw new AdapterError(
        'localStorage is not available in the current environment. ' +
          'This may be due to private browsing mode, security restrictions, or an SSR context.',
      );
    }
    this.storage = window.localStorage;
  }

  async getRaw(key: string): Promise<string | null> {
    return this.storage.getItem(key);
  }

  async setRaw(key: string, value: string): Promise<void> {
    try {
      this.storage.setItem(key, value);
    } catch (err) {
      // DOMException: QuotaExceededError
      throw new AdapterError(
        `localStorage quota exceeded while writing key "${key}".`,
        err,
      );
    }
  }

  async delete(key: string): Promise<void> {
    this.storage.removeItem(key);
  }

  async existsRaw(key: string): Promise<boolean> {
    return this.storage.getItem(key) !== null;
  }

  async clear(): Promise<void> {
    this.storage.clear();
  }

  async keys(): Promise<string[]> {
    const result: string[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const k = this.storage.key(i);
      if (k !== null) result.push(k);
    }
    return result;
  }
}
