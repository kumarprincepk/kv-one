// ─────────────────────────────────────────────────────────────────────────────
// Custom error hierarchy for kv-one
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base error class for all `kv-one` errors.
 * Always carry a `code` string so consumers can switch on the error type
 * without relying on `instanceof` across module boundaries.
 */
export class KVError extends Error {
  public readonly code: string;

  constructor(message: string, code: string, cause?: unknown) {
    super(message);
    this.name = 'KVError';
    this.code = code;

    // Maintain proper prototype chain for `instanceof` checks
    Object.setPrototypeOf(this, new.target.prototype);

    if (cause !== undefined) {
      // Error.cause is ES2022+ but we use Object.assign for ES2020 lib compat
      Object.assign(this, { cause });
    }
  }
}

/**
 * Thrown when no suitable adapter can be detected for the current runtime,
 * and no explicit adapter was provided via `KVOptions`.
 */
export class AdapterNotFoundError extends KVError {
  constructor(runtime: string) {
    super(
      `No KV adapter found for runtime "${runtime}". ` +
        'Pass an explicit adapter via createKV({ adapter }) or ensure the runtime is supported.',
      'ADAPTER_NOT_FOUND',
    );
    this.name = 'AdapterNotFoundError';
  }
}

/**
 * Thrown when JSON serialization or deserialization of a value fails.
 */
export class SerializationError extends KVError {
  constructor(operation: 'serialize' | 'deserialize', cause?: unknown) {
    super(
      `Failed to ${operation} value. Ensure the value is JSON-serializable and does not contain circular references.`,
      'SERIALIZATION_ERROR',
      cause,
    );
    this.name = 'SerializationError';
  }
}

/**
 * Thrown when an invalid TTL value is provided (e.g., negative or non-integer).
 */
export class TTLError extends KVError {
  constructor(ttl: unknown) {
    super(
      `Invalid TTL value: ${String(ttl)}. TTL must be a positive integer (seconds).`,
      'TTL_INVALID',
    );
    this.name = 'TTLError';
  }
}

/**
 * Thrown when a key fails validation (e.g., empty string or illegal characters).
 */
export class KeyValidationError extends KVError {
  constructor(key: unknown) {
    super(
      `Invalid key: ${JSON.stringify(key)}. Keys must be non-empty strings containing only alphanumeric characters, hyphens, underscores, colons, or dots.`,
      'KEY_INVALID',
    );
    this.name = 'KeyValidationError';
  }
}

/**
 * Thrown when the underlying adapter encounters an unrecoverable error
 * (e.g., storage quota exceeded, permission denied).
 */
export class AdapterError extends KVError {
  constructor(message: string, cause?: unknown) {
    super(message, 'ADAPTER_ERROR', cause);
    this.name = 'AdapterError';
  }
}

/**
 * Thrown when an attempt is made to call an adapter method that is not
 * supported by the current runtime (e.g., `keys()` on a CF Workers binding
 * without list permissions).
 */
export class UnsupportedOperationError extends KVError {
  constructor(operation: string, adapterName: string) {
    super(
      `Operation "${operation}" is not supported by the "${adapterName}" adapter.`,
      'UNSUPPORTED_OPERATION',
    );
    this.name = 'UnsupportedOperationError';
  }
}
