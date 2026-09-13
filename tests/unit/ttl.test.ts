import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  computeExpiry,
  isExpired,
  validateTTL,
  ttlToExpiry,
  remainingTTL,
} from '../../src/core/ttl';
import { TTLError } from '../../src/core/errors';

describe('validateTTL()', () => {
  it('accepts positive integers', () => {
    expect(() => validateTTL(1)).not.toThrow();
    expect(() => validateTTL(60)).not.toThrow();
    expect(() => validateTTL(86400)).not.toThrow();
  });

  it('throws TTLError for zero', () => {
    expect(() => validateTTL(0)).toThrow(TTLError);
  });

  it('throws TTLError for negative values', () => {
    expect(() => validateTTL(-1)).toThrow(TTLError);
    expect(() => validateTTL(-60)).toThrow(TTLError);
  });

  it('throws TTLError for floats', () => {
    expect(() => validateTTL(1.5)).toThrow(TTLError);
    expect(() => validateTTL(0.1)).toThrow(TTLError);
  });

  it('throws TTLError for Infinity', () => {
    expect(() => validateTTL(Infinity)).toThrow(TTLError);
  });

  it('throws TTLError for NaN', () => {
    expect(() => validateTTL(NaN)).toThrow(TTLError);
  });

  it('throws TTLError for strings', () => {
    expect(() => validateTTL('60')).toThrow(TTLError);
  });

  it('throws TTLError for null', () => {
    expect(() => validateTTL(null)).toThrow(TTLError);
  });

  it('throws TTLError for undefined', () => {
    expect(() => validateTTL(undefined)).toThrow(TTLError);
  });
});

describe('computeExpiry()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('computes correct expiry for 60 seconds TTL', () => {
    const expiry = computeExpiry(60);
    expect(expiry).toBe(new Date('2025-01-01T00:01:00.000Z').getTime());
  });

  it('computes correct expiry for 1 hour TTL', () => {
    const expiry = computeExpiry(3600);
    expect(expiry).toBe(new Date('2025-01-01T01:00:00.000Z').getTime());
  });

  it('throws TTLError for invalid TTL', () => {
    expect(() => computeExpiry(0)).toThrow(TTLError);
    expect(() => computeExpiry(-1)).toThrow(TTLError);
  });
});

describe('isExpired()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns false for null (no expiry)', () => {
    expect(isExpired(null)).toBe(false);
  });

  it('returns false for a future timestamp', () => {
    const future = Date.now() + 60_000;
    expect(isExpired(future)).toBe(false);
  });

  it('returns true for a past timestamp', () => {
    const past = Date.now() - 1;
    expect(isExpired(past)).toBe(true);
  });

  it('returns true for exact current timestamp (boundary)', () => {
    const now = Date.now();
    expect(isExpired(now)).toBe(true);
  });
});

describe('ttlToExpiry()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null for undefined TTL', () => {
    expect(ttlToExpiry(undefined)).toBeNull();
  });

  it('returns null for TTL of 0', () => {
    expect(ttlToExpiry(0)).toBeNull();
  });

  it('returns future timestamp for positive TTL', () => {
    const result = ttlToExpiry(60);
    expect(result).toBe(new Date('2025-01-01T00:01:00.000Z').getTime());
  });
});

describe('remainingTTL()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null for no expiry', () => {
    expect(remainingTTL(null)).toBeNull();
  });

  it('returns remaining seconds for future expiry', () => {
    const exp = Date.now() + 120_000; // 2 minutes from "now"
    expect(remainingTTL(exp)).toBe(120);
  });

  it('returns 0 for expired entries', () => {
    const exp = Date.now() - 1_000;
    expect(remainingTTL(exp)).toBe(0);
  });
});
