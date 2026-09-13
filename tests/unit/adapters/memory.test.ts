import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryAdapter } from '../../../src/adapters/memory';

describe('MemoryAdapter', () => {
  let adapter: MemoryAdapter;

  beforeEach(() => {
    adapter = new MemoryAdapter();
  });

  describe('getRaw() / setRaw()', () => {
    it('returns null for a non-existent key', async () => {
      expect(await adapter.getRaw('missing')).toBeNull();
    });

    it('stores and retrieves a string value', async () => {
      await adapter.setRaw('key1', 'value1');
      expect(await adapter.getRaw('key1')).toBe('value1');
    });

    it('overwrites an existing value', async () => {
      await adapter.setRaw('key1', 'original');
      await adapter.setRaw('key1', 'updated');
      expect(await adapter.getRaw('key1')).toBe('updated');
    });

    it('stores multiple independent keys', async () => {
      await adapter.setRaw('a', 'alpha');
      await adapter.setRaw('b', 'beta');
      expect(await adapter.getRaw('a')).toBe('alpha');
      expect(await adapter.getRaw('b')).toBe('beta');
    });
  });

  describe('delete()', () => {
    it('removes a key', async () => {
      await adapter.setRaw('key', 'value');
      await adapter.delete('key');
      expect(await adapter.getRaw('key')).toBeNull();
    });

    it('does not throw when deleting a non-existent key', async () => {
      await expect(adapter.delete('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('existsRaw()', () => {
    it('returns false for non-existent key', async () => {
      expect(await adapter.existsRaw('x')).toBe(false);
    });

    it('returns true for existing key', async () => {
      await adapter.setRaw('x', '1');
      expect(await adapter.existsRaw('x')).toBe(true);
    });

    it('returns false after deletion', async () => {
      await adapter.setRaw('x', '1');
      await adapter.delete('x');
      expect(await adapter.existsRaw('x')).toBe(false);
    });
  });

  describe('clear()', () => {
    it('removes all keys', async () => {
      await adapter.setRaw('a', '1');
      await adapter.setRaw('b', '2');
      await adapter.setRaw('c', '3');
      await adapter.clear();
      expect(await adapter.keys()).toEqual([]);
      expect(adapter.size).toBe(0);
    });

    it('resolves without error on empty store', async () => {
      await expect(adapter.clear()).resolves.toBeUndefined();
    });
  });

  describe('keys()', () => {
    it('returns empty array when store is empty', async () => {
      expect(await adapter.keys()).toEqual([]);
    });

    it('returns all stored keys', async () => {
      await adapter.setRaw('z', '1');
      await adapter.setRaw('a', '2');
      await adapter.setRaw('m', '3');
      const keys = await adapter.keys();
      expect(keys.sort()).toEqual(['a', 'm', 'z']);
    });

    it('does not include deleted keys', async () => {
      await adapter.setRaw('keep', '1');
      await adapter.setRaw('remove', '2');
      await adapter.delete('remove');
      expect(await adapter.keys()).toEqual(['keep']);
    });
  });

  describe('size getter', () => {
    it('reflects current item count', async () => {
      expect(adapter.size).toBe(0);
      await adapter.setRaw('a', '1');
      expect(adapter.size).toBe(1);
      await adapter.setRaw('b', '2');
      expect(adapter.size).toBe(2);
      await adapter.delete('a');
      expect(adapter.size).toBe(1);
    });
  });
});
