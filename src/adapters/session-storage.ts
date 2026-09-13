import { AdapterError } from '../core/errors.js';
import { BaseAdapter } from './base.js';

// ─────────────────────────────────────────────────────────────────────────────
// sessionStorage Adapter (Browser)
//
// Identical surface to LocalStorageAdapter but uses sessionStorage.
// Data is cleared when the browser tab/window is closed.
// ─────────────────────────────────────────────────────────────────────────────

function isSessionStorageAvailable(): boolean {
  try {
    const testKey = '__ukv_test__';
    window.sessionStorage.setItem(testKey, '1');
    window.sessionStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

export class SessionStorageAdapter extends BaseAdapter {
  readonly name = 'SessionStorageAdapter';

  private readonly storage: Storage;

  constructor() {
    super();
    if (typeof window === 'undefined' || !isSessionStorageAvailable()) {
      throw new AdapterError(
        'sessionStorage is not available in the current environment.',
      );
    }
    this.storage = window.sessionStorage;
  }

  async getRaw(key: string): Promise<string | null> {
    return this.storage.getItem(key);
  }

  async setRaw(key: string, value: string): Promise<void> {
    try {
      this.storage.setItem(key, value);
    } catch (err) {
      throw new AdapterError(
        `sessionStorage quota exceeded while writing key "${key}".`,
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
