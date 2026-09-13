import type { IKVAdapter } from '../core/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Abstract base class for all adapters
//
// Adapters only deal with raw string I/O — no TTL, no serialization.
// That logic lives in the KVClient / core layer.
// ─────────────────────────────────────────────────────────────────────────────

export abstract class BaseAdapter implements IKVAdapter {
  /** Human-readable name used in error messages. */
  abstract readonly name: string;

  abstract getRaw(key: string): Promise<string | null>;
  abstract setRaw(key: string, value: string): Promise<void>;
  abstract delete(key: string): Promise<void>;
  abstract existsRaw(key: string): Promise<boolean>;
  abstract clear(): Promise<void>;
  abstract keys(): Promise<string[]>;
}
