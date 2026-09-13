/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { LocalStorageAdapter } from '../../../src/adapters/local-storage';
import { AdapterError } from '../../../src/core/errors';

describe('LocalStorageAdapter', () => {
  let adapter: LocalStorageAdapter;

  beforeEach(() => {
    window.localStorage.clear();
    adapter = new LocalStorageAdapter();
  });

  describe('getRaw() / setRaw()', () => {
    it('returns null for a non-existent key', async () => {
      expect(await adapter.getRaw('missing')).toBeNull();
    });

    it('stores and retrieves a string value', async () => {
      await adapter.setRaw('hello', 'world');
      expect(await adapter.getRaw('hello')).toBe('world');
    });

    it('overwrites an existing value', async () => {
      await adapter.setRaw('k', 'v1');
      await adapter.setRaw('k', 'v2');
      expect(await adapter.getRaw('k')).toBe('v2');
    });
  });

  describe('delete()', () => {
    it('removes a key', async () => {
      await adapter.setRaw('x', 'y');
      await adapter.delete('x');
      expect(await adapter.getRaw('x')).toBeNull();
    });

    it('does not throw when deleting non-existent key', async () => {
      await expect(adapter.delete('ghost')).resolves.toBeUndefined();
    });
  });

  describe('existsRaw()', () => {
    it('returns false for missing key', async () => {
      expect(await adapter.existsRaw('nope')).toBe(false);
    });

    it('returns true for existing key', async () => {
      await adapter.setRaw('yes', '1');
      expect(await adapter.existsRaw('yes')).toBe(true);
    });
  });

  describe('clear()', () => {
    it('removes all keys', async () => {
      await adapter.setRaw('a', '1');
      await adapter.setRaw('b', '2');
      await adapter.clear();
      expect(await adapter.keys()).toEqual([]);
    });
  });

  describe('keys()', () => {
    it('returns empty array when empty', async () => {
      expect(await adapter.keys()).toEqual([]);
    });

    it('returns all stored keys', async () => {
      await adapter.setRaw('k1', 'v1');
      await adapter.setRaw('k2', 'v2');
      const keys = await adapter.keys();
      expect(keys.sort()).toEqual(['k1', 'k2']);
    });
  });

  describe('quota exceeded handling', () => {
    it('throws AdapterError when setItem throws QuotaExceededError', async () => {
      // In jsdom, window.localStorage is a Proxy and direct property assignment
      // is ignored. We stub via Object.defineProperty on Storage.prototype.
      const originalDescriptor = Object.getOwnPropertyDescriptor(
        Storage.prototype,
        'setItem',
      );
      const quotaError = new DOMException('QuotaExceededError', 'QuotaExceededError');

      Object.defineProperty(Storage.prototype, 'setItem', {
        configurable: true,
        writable: true,
        value: () => { throw quotaError; },
      });

      try {
        await expect(adapter.setRaw('key', 'value')).rejects.toThrow(AdapterError);
      } finally {
        // Always restore the original descriptor
        if (originalDescriptor) {
          Object.defineProperty(Storage.prototype, 'setItem', originalDescriptor);
        }
      }
    });
  });
});
