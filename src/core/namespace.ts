import { KeyValidationError } from './errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// Key validation & namespacing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pattern: alphanumeric, hyphens, underscores, colons, and dots.
 * Colons are used as the namespace separator internally.
 */
const VALID_KEY_RE = /^[a-zA-Z0-9\-_:.]+$/;

/**
 * Validate a user-supplied key segment (before any namespace prefix is applied).
 *
 * @throws {@link KeyValidationError} for empty strings or illegal characters
 */
export function validateKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || key.length === 0 || !VALID_KEY_RE.test(key)) {
    throw new KeyValidationError(key);
  }
}

/**
 * Apply a namespace prefix to a key.
 * e.g. `applyPrefix('users', 'alice')` → `'users:alice'`
 */
export function applyPrefix(prefix: string, key: string): string {
  return `${prefix}:${key}`;
}

/**
 * Strip the namespace prefix from a key, returning the bare key.
 * Returns the original key unchanged if it does not start with the prefix.
 */
export function stripPrefix(prefix: string, key: string): string {
  const prefixWithSep = `${prefix}:`;
  if (key.startsWith(prefixWithSep)) {
    return key.slice(prefixWithSep.length);
  }
  return key;
}

/**
 * Returns `true` if `key` belongs to the given namespace prefix.
 */
export function hasPrefix(prefix: string, key: string): boolean {
  return key.startsWith(`${prefix}:`);
}
