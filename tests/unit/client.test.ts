import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { KVClient } from '../../src/client/index';
import { MemoryAdapter } from '../../src/adapters/memory';
import { TTLError, KeyValidationError, SerializationError } from '../../src/core/errors';

// All client tests use an explicit MemoryAdapter to avoid runtime detection
function createClient(prefix?: string): KVClient {
  return new KVClient({
    adapter: new MemoryAdapter(),
    ...(prefix !== undefined ? { prefix } : {}),
  });
}

describe('KVClient — basic CRUD', () => {
  let client: KVClient;

  beforeEach(() => {
    client = createClient();
  });

  it('returns null for a non-existent key', async () => {
    expect(await client.get('missing')).toBeNull();
  });

  it('stores and retrieves a string', async () => {
    await client.set('name', 'Alice');
    expect(await client.get('name')).toBe('Alice');
  });

  it('stores and retrieves an object', async () => {
    const user = { id: 1, role: 'admin' };
    await client.set('user', user);
    expect(await client.get('user')).toEqual(user);
  });

  it('stores and retrieves a number', async () => {
    await client.set('count', 42);
    expect(await client.get<number>('count')).toBe(42);
  });

  it('stores and retrieves a boolean', async () => {
    await client.set('flag', true);
    expect(await client.get<boolean>('flag')).toBe(true);
  });

  it('stores and retrieves null', async () => {
    await client.set('nul', null);
    expect(await client.get('nul')).toBeNull();
    // Distinguishable from missing key via has()
    expect(await client.has('nul')).toBe(false); // null value == expired/missing from API perspective
  });

  it('stores and retrieves an array', async () => {
    await client.set('arr', [1, 2, 3]);
    expect(await client.get<number[]>('arr')).toEqual([1, 2, 3]);
  });

  it('overwrites an existing key', async () => {
    await client.set('x', 'old');
    await client.set('x', 'new');
    expect(await client.get('x')).toBe('new');
  });
});

describe('KVClient — delete()', () => {
  let client: KVClient;

  beforeEach(() => {
    client = createClient();
  });

  it('deletes an existing key', async () => {
    await client.set('d', 'value');
    await client.delete('d');
    expect(await client.get('d')).toBeNull();
  });

  it('does not throw when deleting a non-existent key', async () => {
    await expect(client.delete('ghost')).resolves.toBeUndefined();
  });
});

describe('KVClient — has()', () => {
  let client: KVClient;

  beforeEach(() => {
    client = createClient();
  });

  it('returns false for a missing key', async () => {
    expect(await client.has('nope')).toBe(false);
  });

  it('returns true for an existing key with a non-null value', async () => {
    await client.set('exists', 'yes');
    expect(await client.has('exists')).toBe(true);
  });

  it('returns false after the key is deleted', async () => {
    await client.set('temp', 'val');
    await client.delete('temp');
    expect(await client.has('temp')).toBe(false);
  });
});

describe('KVClient — clear()', () => {
  let client: KVClient;

  beforeEach(() => {
    client = createClient();
  });

  it('removes all keys', async () => {
    await client.set('a', 1);
    await client.set('b', 2);
    await client.clear();
    expect(await client.keys()).toEqual([]);
  });

  it('resolves without error on empty store', async () => {
    await expect(client.clear()).resolves.toBeUndefined();
  });
});

describe('KVClient — keys() and entries()', () => {
  let client: KVClient;

  beforeEach(() => {
    client = createClient();
  });

  it('returns empty array when no keys exist', async () => {
    expect(await client.keys()).toEqual([]);
  });

  it('returns all non-expired keys', async () => {
    await client.set('a', 1);
    await client.set('b', 2);
    const keys = await client.keys();
    expect(keys.sort()).toEqual(['a', 'b']);
  });

  it('returns all entries as [key, value] pairs', async () => {
    await client.set('x', 10);
    await client.set('y', 20);
    const entries = await client.entries<number>();
    const sorted = entries.sort(([a], [b]) => a.localeCompare(b));
    expect(sorted).toEqual([['x', 10], ['y', 20]]);
  });
});

describe('KVClient — TTL', () => {
  let client: KVClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    client = createClient();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns value before TTL expires', async () => {
    await client.set('session', 'token', { ttl: 60 });
    vi.advanceTimersByTime(59_000);
    expect(await client.get('session')).toBe('token');
  });

  it('returns null after TTL expires', async () => {
    await client.set('session', 'token', { ttl: 60 });
    vi.advanceTimersByTime(61_000);
    expect(await client.get('session')).toBeNull();
  });

  it('lazy-deletes expired entries on get()', async () => {
    const adapter = new MemoryAdapter();
    const c = new KVClient({ adapter });
    await c.set('exp', 'val', { ttl: 1 });
    expect(adapter.size).toBe(1);
    vi.advanceTimersByTime(2_000);
    await c.get('exp');
    expect(adapter.size).toBe(0);
  });

  it('expired keys do not appear in keys()', async () => {
    await client.set('live', 'yes', { ttl: 120 });
    await client.set('dead', 'no', { ttl: 10 });
    vi.advanceTimersByTime(11_000);
    const keys = await client.keys();
    expect(keys).toContain('live');
    expect(keys).not.toContain('dead');
  });

  it('throws TTLError for invalid TTL (0)', async () => {
    await expect(client.set('k', 'v', { ttl: 0 })).rejects.toThrow(TTLError);
  });

  it('throws TTLError for negative TTL', async () => {
    await expect(client.set('k', 'v', { ttl: -1 })).rejects.toThrow(TTLError);
  });

  it('throws TTLError for float TTL', async () => {
    await expect(client.set('k', 'v', { ttl: 1.5 })).rejects.toThrow(TTLError);
  });
});

describe('KVClient — key validation', () => {
  let client: KVClient;

  beforeEach(() => {
    client = createClient();
  });

  it('accepts valid keys', async () => {
    await expect(client.set('valid-key_1.abc:sub', 'v')).resolves.toBeUndefined();
  });

  it('throws KeyValidationError for empty string key', async () => {
    await expect(client.set('', 'v')).rejects.toThrow(KeyValidationError);
  });

  it('throws KeyValidationError for key with spaces', async () => {
    await expect(client.set('bad key', 'v')).rejects.toThrow(KeyValidationError);
  });

  it('throws KeyValidationError for key with special chars', async () => {
    await expect(client.set('key@domain', 'v')).rejects.toThrow(KeyValidationError);
  });
});

describe('KVClient — serialization errors', () => {
  let client: KVClient;

  beforeEach(() => {
    client = createClient();
  });

  it('throws SerializationError for circular reference values', async () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    await expect(client.set('circ', circular)).rejects.toThrow(SerializationError);
  });
});

describe('KVClient — namespace()', () => {
  let adapter: MemoryAdapter;
  let client: KVClient;

  beforeEach(() => {
    adapter = new MemoryAdapter();
    client = new KVClient({ adapter });
  });

  it('creates a namespaced sub-client', async () => {
    const ns = client.namespace('users');
    await ns.set('alice', { role: 'admin' });
    // Should NOT be accessible without the prefix
    expect(await client.get('alice')).toBeNull();
    // Should be accessible via the namespace
    expect(await ns.get('alice')).toEqual({ role: 'admin' });
  });

  it('stores keys with the namespace prefix', async () => {
    const ns = client.namespace('settings');
    await ns.set('theme', 'dark');
    // Check the raw adapter directly
    const rawKeys = await adapter.keys();
    expect(rawKeys).toContain('settings:theme');
  });

  it('keys() in namespace only returns un-prefixed keys', async () => {
    const ns = client.namespace('ns');
    await ns.set('a', 1);
    await ns.set('b', 2);
    await client.set('c', 3); // Not in namespace
    const nsKeys = await ns.keys();
    expect(nsKeys.sort()).toEqual(['a', 'b']);
    expect(nsKeys).not.toContain('c');
  });

  it('clear() in namespace only removes namespaced keys', async () => {
    const ns = client.namespace('cache');
    await ns.set('x', 1);
    await client.set('global', 2);
    await ns.clear();
    expect(await ns.get('x')).toBeNull();
    expect(await client.get('global')).toBe(2);
  });

  it('supports nested namespaces', async () => {
    const userNS = client.namespace('users');
    const adminNS = userNS.namespace('admin');
    await adminNS.set('token', 'abc');
    const rawKeys = await adapter.keys();
    expect(rawKeys).toContain('users:admin:token');
  });

  it('throws KeyValidationError for invalid namespace prefix', () => {
    expect(() => client.namespace('bad prefix')).toThrow(KeyValidationError);
  });
});
