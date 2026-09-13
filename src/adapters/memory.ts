import { BaseAdapter } from './base.js';

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Adapter
//
// Backed by a plain Map<string, string>.  Suitable for:
//   • Node.js (default adapter)
//   • Test / CI environments
//   • SSR fallback when no persistent storage is available
//
// Thread safety: JavaScript is single-threaded, so no locking is required.
// ─────────────────────────────────────────────────────────────────────────────

export class MemoryAdapter extends BaseAdapter {
  readonly name = 'MemoryAdapter';

  private readonly store: Map<string, string> = new Map();

  async getRaw(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async setRaw(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async existsRaw(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async keys(): Promise<string[]> {
    return Array.from(this.store.keys());
  }

  /** Number of raw entries currently stored (includes expired envelopes). */
  get size(): number {
    return this.store.size;
  }
}
