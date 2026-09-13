import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createKV } from '../../src/client/factory';
import { MemoryAdapter } from '../../src/adapters/memory';

describe('Integration: namespace isolation', () => {
  it('two different namespaces are completely isolated', async () => {
    const adapter = new MemoryAdapter();
    const client = createKV({ adapter });

    const userKV = client.namespace('users');
    const sessionKV = client.namespace('sessions');

    await userKV.set('alice', { role: 'admin' });
    await sessionKV.set('alice', { token: 'xyz' });

    const userAlice = await userKV.get<{ role: string }>('alice');
    const sessionAlice = await sessionKV.get<{ token: string }>('alice');

    expect(userAlice).toEqual({ role: 'admin' });
    expect(sessionAlice).toEqual({ token: 'xyz' });
  });

  it('clearing one namespace does not affect another', async () => {
    const adapter = new MemoryAdapter();
    const client = createKV({ adapter });

    const ns1 = client.namespace('ns1');
    const ns2 = client.namespace('ns2');

    await ns1.set('a', 1);
    await ns2.set('b', 2);

    await ns1.clear();

    expect(await ns1.get('a')).toBeNull();
    expect(await ns2.get('b')).toBe(2);
  });

  it('deeply nested namespaces work correctly', async () => {
    const client = createKV({ adapter: new MemoryAdapter() });
    const deep = client.namespace('a').namespace('b').namespace('c');
    await deep.set('key', 'value');
    expect(await deep.get('key')).toBe('value');

    // Verify raw prefix
    const parentKeys = await client.namespace('a').namespace('b').keys();
    // 'c:key' is the exposed key relative to 'a:b' namespace
    expect(parentKeys).toContain('c:key');
  });
});

describe('Integration: TTL across multiple keys', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('only expired keys are hidden in a mixed TTL scenario', async () => {
    const client = createKV({ adapter: new MemoryAdapter() });

    await client.set('permanent', 'always');
    await client.set('short', 'expires-soon', { ttl: 10 });
    await client.set('long', 'expires-later', { ttl: 120 });

    // Advance 11 seconds — 'short' should expire
    vi.advanceTimersByTime(11_000);

    const keys = await client.keys();
    expect(keys).toContain('permanent');
    expect(keys).toContain('long');
    expect(keys).not.toContain('short');
  });

  it('entries() excludes expired values', async () => {
    const client = createKV({ adapter: new MemoryAdapter() });

    await client.set('live', 'yes', { ttl: 60 });
    await client.set('dead', 'no', { ttl: 1 });

    vi.advanceTimersByTime(2_000);

    const entries = await client.entries<string>();
    const map = Object.fromEntries(entries);
    expect(map['live']).toBe('yes');
    expect(map['dead']).toBeUndefined();
  });
});

describe('Integration: createKV factory', () => {
  it('creates an independent client per call', async () => {
    const client1 = createKV({ adapter: new MemoryAdapter() });
    const client2 = createKV({ adapter: new MemoryAdapter() });

    await client1.set('x', 'from-client1');
    expect(await client2.get('x')).toBeNull();
  });

  it('shares state when the same adapter instance is passed', async () => {
    const shared = new MemoryAdapter();
    const client1 = createKV({ adapter: shared });
    const client2 = createKV({ adapter: shared });

    await client1.set('shared', 'value');
    expect(await client2.get('shared')).toBe('value');
  });
});
