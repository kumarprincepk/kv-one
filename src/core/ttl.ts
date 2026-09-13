import { TTLError } from './errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// TTL utilities — all logic lives here, never in adapters
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate and compute the absolute expiry timestamp (Unix ms) for a given TTL.
 *
 * @param ttl - Time-to-live in **seconds**
 * @returns Absolute expiry timestamp in milliseconds
 * @throws {@link TTLError} if `ttl` is not a positive integer
 */
export function computeExpiry(ttl: number): number {
  validateTTL(ttl);
  return Date.now() + ttl * 1_000;
}

/**
 * Returns `true` if the given expiry timestamp has passed.
 * A `null` expiry means the entry never expires.
 */
export function isExpired(exp: number | null): boolean {
  if (exp === null) return false;
  return Date.now() >= exp;
}

/**
 * Validate that a TTL value is a positive finite integer.
 * @throws {@link TTLError} on invalid input
 */
export function validateTTL(ttl: unknown): asserts ttl is number {
  if (
    typeof ttl !== 'number' ||
    !Number.isFinite(ttl) ||
    !Number.isInteger(ttl) ||
    ttl <= 0
  ) {
    throw new TTLError(ttl);
  }
}

/**
 * Convert TTL (seconds) to an expiry timestamp (ms), or `null` if no TTL.
 * The zero-check ensures that `ttl: 0` is treated as "no TTL" (safe default).
 */
export function ttlToExpiry(ttl: number | undefined): number | null {
  if (ttl === undefined || ttl === 0) return null;
  return computeExpiry(ttl);
}

/**
 * Compute remaining TTL in seconds from an absolute expiry timestamp.
 * Returns `null` if no expiry is set.
 * Returns `0` if already expired (consumer can decide what to do).
 */
export function remainingTTL(exp: number | null): number | null {
  if (exp === null) return null;
  const remaining = Math.ceil((exp - Date.now()) / 1_000);
  return Math.max(0, remaining);
}
