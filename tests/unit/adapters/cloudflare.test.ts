import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudflareAdapter } from '../../../src/adapters/cloudflare';
import type { CFKVNamespace } from '../../../src/adapters/cloudflare';
import { AdapterError } from '../../../src/core/errors';

// ─── Mock KVNamespace ─────────────────────────────────────────────────────────

function createMockNamespace(): CFKVNamespace {
  const store: Map<string, string> = new Map();

  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    list: vi.fn(async () => ({
      keys: Array.from(store.keys()).map((name) => ({ name })),
      list_complete: true as const,
    })),
  };
}

describe('CloudflareAdapter', () => {
  let ns: CFKVNamespace;
  let adapter: CloudflareAdapter;

  beforeEach(() => {
    ns = createMockNamespace();
    adapter = new CloudflareAdapter({ namespace: ns });
  });

  describe('getRaw()', () => {
    it('returns null for non-existent key', async () => {
      expect(await adapter.getRaw('missing')).toBeNull();
    });

    it('retrieves a stored value via the KV namespace', async () => {
      await adapter.setRaw('hello', 'world');
      expect(await adapter.getRaw('hello')).toBe('world');
    });

    it('throws AdapterError when namespace.get throws', async () => {
      vi.mocked(ns.get).mockRejectedValueOnce(new Error('KV read failure'));
      await expect(adapter.getRaw('key')).rejects.toThrow(AdapterError);
    });
  });

  describe('setRaw()', () => {
    it('calls namespace.put with the correct arguments', async () => {
      await adapter.setRaw('k', 'v');
      expect(ns.put).toHaveBeenCalledWith('k', 'v');
    });

    it('throws AdapterError when namespace.put throws', async () => {
      vi.mocked(ns.put).mockRejectedValueOnce(new Error('KV write failure'));
      await expect(adapter.setRaw('key', 'val')).rejects.toThrow(AdapterError);
    });
  });

  describe('delete()', () => {
    it('calls namespace.delete with the correct key', async () => {
      await adapter.delete('k');
      expect(ns.delete).toHaveBeenCalledWith('k');
    });

    it('throws AdapterError when namespace.delete throws', async () => {
      vi.mocked(ns.delete).mockRejectedValueOnce(new Error('delete failure'));
      await expect(adapter.delete('k')).rejects.toThrow(AdapterError);
    });
  });

  describe('existsRaw()', () => {
    it('returns false when key does not exist', async () => {
      expect(await adapter.existsRaw('nope')).toBe(false);
    });

    it('returns true when key exists', async () => {
      await adapter.setRaw('yep', '1');
      expect(await adapter.existsRaw('yep')).toBe(true);
    });
  });

  describe('keys()', () => {
    it('returns all keys from the namespace listing', async () => {
      await adapter.setRaw('a', '1');
      await adapter.setRaw('b', '2');
      const keys = await adapter.keys();
      expect(keys.sort()).toEqual(['a', 'b']);
    });

    it('handles paginated listings (list_complete: false)', async () => {
      const store = new Map<string, string>();
      store.set('page1-key', 'v');

      vi.mocked(ns.list).mockImplementationOnce(async () => ({
          keys: [{ name: 'page1-key' }],
          list_complete: false as const,
          cursor: 'cursor-abc',
        }));
      vi.mocked(ns.list).mockImplementationOnce(async () => ({
          keys: [{ name: 'page2-key' }],
          list_complete: true as const,
        }));

      const keys = await adapter.keys();
      expect(keys).toContain('page1-key');
      expect(keys).toContain('page2-key');
    });
  });

  describe('clear()', () => {
    it('deletes all keys', async () => {
      await adapter.setRaw('x', '1');
      await adapter.setRaw('y', '2');
      await adapter.clear();
      expect(await adapter.keys()).toEqual([]);
    });
  });
});
