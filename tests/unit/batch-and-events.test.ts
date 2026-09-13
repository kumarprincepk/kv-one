import { describe, it, expect, beforeEach } from 'vitest';
import { KVClient } from '../../src/client/index';
import { MemoryAdapter } from '../../src/adapters/memory';

// ─────────────────────────────────────────────────────────────────────────────
// Batch Operations Tests (mset / mget / mdelete)
// ─────────────────────────────────────────────────────────────────────────────

describe('KVClient — batch operations', () => {
  let kv: KVClient;

  beforeEach(() => {
    kv = new KVClient({ adapter: new MemoryAdapter() });
  });

  // ── mset ──────────────────────────────────────────────────────────────────

  describe('mset()', () => {
    it('writes multiple keys in one call', async () => {
      await kv.mset([
        { key: 'a', value: 1 },
        { key: 'b', value: 2 },
        { key: 'c', value: 3 },
      ]);
      expect(await kv.get('a')).toBe(1);
      expect(await kv.get('b')).toBe(2);
      expect(await kv.get('c')).toBe(3);
    });

    it('accepts individual TTLs per item', async () => {
      await kv.mset([
        { key: 'short', value: 'expires', ttl: 1 },
        { key: 'permanent', value: 'forever' },
      ]);
      expect(await kv.get('short')).toBe('expires');
      expect(await kv.get('permanent')).toBe('forever');
    });

    it('resolves with void for an empty array', async () => {
      await expect(kv.mset([])).resolves.toBeUndefined();
    });

    it('throws TypeError if argument is not an array', async () => {
      await expect(kv.mset('not-array' as unknown as [])).rejects.toThrow(TypeError);
    });

    it('validates each key through the existing key validator', async () => {
      // Keys with spaces are invalid
      await expect(
        kv.mset([{ key: 'valid', value: 1 }, { key: 'bad key', value: 2 }]),
      ).rejects.toThrow();
    });

    it('validates TTL through the existing TTL validator', async () => {
      await expect(
        kv.mset([{ key: 'k', value: 1, ttl: -5 }]),
      ).rejects.toThrow();
    });
  });

  // ── mget ──────────────────────────────────────────────────────────────────

  describe('mget()', () => {
    beforeEach(async () => {
      await kv.mset<string | number>([
        { key: 'x', value: 'hello' },
        { key: 'y', value: 42 },
      ]);
    });

    it('retrieves multiple keys and preserves input order', async () => {
      const results = await kv.mget(['x', 'y', 'z-missing']);
      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ key: 'x', value: 'hello' });
      expect(results[1]).toEqual({ key: 'y', value: 42 });
      expect(results[2]).toEqual({ key: 'z-missing', value: null });
    });

    it('returns null for missing keys', async () => {
      const results = await kv.mget(['does-not-exist']);
      expect(results[0]?.value).toBeNull();
    });

    it('resolves with empty array for empty input', async () => {
      const results = await kv.mget([]);
      expect(results).toEqual([]);
    });

    it('throws TypeError if argument is not an array', async () => {
      await expect(kv.mget('oops' as unknown as [])).rejects.toThrow(TypeError);
    });

    it('returns null for invalid key (does not throw the whole batch)', async () => {
      // 'bad key' has a space — invalid, but mget should not abort
      const results = await kv.mget(['x', 'bad key']);
      expect(results[0]).toEqual({ key: 'x', value: 'hello' });
      expect(results[1]).toEqual({ key: 'bad key', value: null });
    });
  });

  // ── mdelete ───────────────────────────────────────────────────────────────

  describe('mdelete()', () => {
    beforeEach(async () => {
      await kv.mset([
        { key: 'del1', value: 'a' },
        { key: 'del2', value: 'b' },
        { key: 'keep', value: 'c' },
      ]);
    });

    it('deletes multiple keys at once', async () => {
      await kv.mdelete(['del1', 'del2']);
      expect(await kv.get('del1')).toBeNull();
      expect(await kv.get('del2')).toBeNull();
      expect(await kv.get('keep')).toBe('c');
    });

    it('resolves without error for non-existent keys', async () => {
      await expect(kv.mdelete(['no-such-key'])).resolves.toBeUndefined();
    });

    it('resolves with void for an empty array', async () => {
      await expect(kv.mdelete([])).resolves.toBeUndefined();
    });

    it('throws TypeError if argument is not an array', async () => {
      await expect(kv.mdelete(null as unknown as [])).rejects.toThrow(TypeError);
    });
  });

  // ── Batch + Namespace ─────────────────────────────────────────────────────

  describe('batch operations with namespacing', () => {
    it('mset and mget respect namespace prefix', async () => {
      const ns = kv.namespace('users');
      await ns.mset([
        { key: 'alice', value: { role: 'admin' } },
        { key: 'bob', value: { role: 'viewer' } },
      ]);

      // Namespaced get works
      const results = await ns.mget(['alice', 'bob']);
      expect(results[0]?.value).toEqual({ role: 'admin' });
      expect(results[1]?.value).toEqual({ role: 'viewer' });

      // Root kv cannot see namespaced keys directly
      expect(await kv.get('alice')).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Event Subscription Tests (on / off)
// ─────────────────────────────────────────────────────────────────────────────

describe('KVClient — event subscriptions', () => {
  let kv: KVClient;

  beforeEach(() => {
    kv = new KVClient({ adapter: new MemoryAdapter() });
  });

  // ── on() / 'set' event ────────────────────────────────────────────────────

  describe("on('set')", () => {
    it('fires after set()', async () => {
      const calls: [string | undefined, unknown][] = [];
      kv.on<unknown>('set', (key: string | undefined, value: unknown) => calls.push([key, value]));

      await kv.set('name', 'Alice');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual(['name', 'Alice']);
    });

    it('fires once per item in mset()', async () => {
      const keys: (string | undefined)[] = [];
      kv.on<unknown>('set', (key: string | undefined) => keys.push(key));

      await kv.mset([{ key: 'a', value: 1 }, { key: 'b', value: 2 }]);
      expect(keys).toContain('a');
      expect(keys).toContain('b');
    });

    it('provides the correct value to the listener', async () => {
      let received: unknown;
      kv.on<unknown>('set', (_key: string | undefined, value: unknown) => { received = value; });

      await kv.set('obj', { x: 99 });
      expect(received).toEqual({ x: 99 });
    });
  });

  // ── on() / 'delete' event ─────────────────────────────────────────────────

  describe("on('delete')", () => {
    it('fires after delete()', async () => {
      const keys: (string | undefined)[] = [];
      kv.on<unknown>('delete', (key: string | undefined) => keys.push(key));

      await kv.set('temp', 'val');
      await kv.delete('temp');
      expect(keys).toEqual(['temp']);
    });

    it('fires once per key in mdelete()', async () => {
      await kv.mset([{ key: 'p', value: 1 }, { key: 'q', value: 2 }]);
      const deleted: (string | undefined)[] = [];
      kv.on<unknown>('delete', (key: string | undefined) => deleted.push(key));

      await kv.mdelete(['p', 'q']);
      expect(deleted).toContain('p');
      expect(deleted).toContain('q');
    });
  });

  // ── on() / 'clear' event ──────────────────────────────────────────────────

  describe("on('clear')", () => {
    it('fires after clear()', async () => {
      let fired = false;
      kv.on('clear', () => { fired = true; });

      await kv.set('x', 1);
      await kv.clear();
      expect(fired).toBe(true);
    });
  });

  // ── off() / unsubscribe ───────────────────────────────────────────────────

  describe('off()', () => {
    it('stops the listener from receiving further events', async () => {
      let count = 0;
      const listener = () => { count++; };
      kv.on('set', listener);

      await kv.set('k1', 'v1');
      kv.off('set', listener);
      await kv.set('k2', 'v2');

      expect(count).toBe(1); // fired once before off()
    });

    it('the returned unsubscribe function works correctly', async () => {
      let count = 0;
      const unsub = kv.on('set', () => { count++; });

      await kv.set('k1', 'v1');
      unsub(); // unsubscribe
      await kv.set('k2', 'v2');

      expect(count).toBe(1);
    });

    it('no-ops silently for unregistered listeners', () => {
      expect(() => kv.off('set', () => {})).not.toThrow();
    });
  });

  // ── Security ──────────────────────────────────────────────────────────────

  describe('event security', () => {
    it('throws TypeError for unknown event type', () => {
      expect(() => kv.on('hack' as 'set', () => {})).toThrow(TypeError);
    });

    it('throws TypeError if listener is not a function', () => {
      expect(() => kv.on('set', 'not-a-function' as unknown as () => void)).toThrow(TypeError);
    });

    it('a throwing listener does not abort the store operation', async () => {
      kv.on('set', () => { throw new Error('Listener crash!'); });

      // The set() must succeed even though the listener threw
      await expect(kv.set('safe', 'value')).resolves.toBeUndefined();
      expect(await kv.get('safe')).toBe('value');
    });

    it('multiple listeners fire independently even if one throws', async () => {
      let secondListenerFired = false;
      kv.on('set', () => { throw new Error('boom'); });
      kv.on('set', () => { secondListenerFired = true; });

      await kv.set('k', 'v');
      expect(secondListenerFired).toBe(true);
    });
  });
});
