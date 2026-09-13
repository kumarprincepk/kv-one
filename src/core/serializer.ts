import { SerializationError } from './errors.js';
import type { StoredEnvelope } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Blocked prototype-pollution keys
// ─────────────────────────────────────────────────────────────────────────────
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * JSON reviver that blocks prototype-pollution attempts by rejecting any
 * key that could mutate Object.prototype.
 */
function safeReviver(key: string, value: unknown): unknown {
  if (BLOCKED_KEYS.has(key)) {
    return undefined;
  }
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// Circular-reference detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Serialize a value to a JSON string.
 *
 * - Detects circular references and throws {@link SerializationError}
 * - Blocks `undefined` top-level values (they round-trip as `null` in JSON)
 * - `null` is valid and serialized as `"null"`
 *
 * @throws {@link SerializationError} if the value cannot be serialized
 */
export function serialize<T>(value: T): string {
  try {
    const seen = new WeakSet<object>();
    const json = JSON.stringify(value, (_key, val: unknown) => {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) {
          throw new SerializationError('serialize', new Error('Circular reference detected'));
        }
        seen.add(val);
      }
      return val;
    });

    if (json === undefined) {
      // JSON.stringify returns undefined for `undefined`, functions, symbols
      throw new SerializationError('serialize', new Error('Value is not JSON-serializable (undefined, function, or symbol)'));
    }

    return json;
  } catch (err) {
    if (err instanceof SerializationError) {
      throw err;
    }
    throw new SerializationError('serialize', err);
  }
}

/**
 * Deserialize a JSON string back to a typed value.
 *
 * Uses a safe reviver to block prototype-pollution keys.
 *
 * @throws {@link SerializationError} if the string is not valid JSON
 */
export function deserialize<T>(raw: string): T {
  try {
    return JSON.parse(raw, safeReviver) as T;
  } catch (err) {
    throw new SerializationError('deserialize', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Envelope helpers (used by the core layer, not adapters)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wrap a value in a {@link StoredEnvelope} and serialize to JSON.
 */
export function serializeEnvelope<T>(value: T, expiresAt: number | null): string {
  const envelope: StoredEnvelope<T> = { v: value, exp: expiresAt };
  return serialize(envelope);
}

/**
 * Deserialize and unwrap a {@link StoredEnvelope} from a raw JSON string.
 *
 * @throws {@link SerializationError} if the string is malformed
 */
export function deserializeEnvelope<T>(raw: string): StoredEnvelope<T> {
  const parsed = deserialize<StoredEnvelope<T>>(raw);

  // Validate envelope shape to guard against corrupted data
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('v' in parsed) ||
    !('exp' in parsed)
  ) {
    throw new SerializationError('deserialize', new Error('Envelope shape mismatch — data may be corrupted'));
  }

  return parsed;
}
