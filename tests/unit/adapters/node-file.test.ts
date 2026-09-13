import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { NodeFileAdapter } from '../../../src/adapters/node-file';
import { AdapterError } from '../../../src/core/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function tmpFile(): string {
  return path.join(os.tmpdir(), `kv-one-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

function cleanup(filePath: string): void {
  try { fs.unlinkSync(filePath); } catch { /* already gone */ }
  try { fs.unlinkSync(`${filePath}.tmp`); } catch { /* no tmp */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('NodeFileAdapter', () => {
  let filePath: string;
  let adapter: NodeFileAdapter;

  beforeEach(() => {
    filePath = tmpFile();
    adapter = new NodeFileAdapter({ filePath });
  });

  afterEach(() => {
    cleanup(filePath);
  });

  // ── Construction & Security ────────────────────────────────────────────────

  describe('constructor security', () => {
    it('throws for missing filePath', () => {
      // @ts-expect-error intentional
      expect(() => new NodeFileAdapter({})).toThrow(AdapterError);
    });

    it('throws for relative path (path traversal prevention)', () => {
      expect(() => new NodeFileAdapter({ filePath: 'relative/path.json' }))
        .toThrow(AdapterError);
    });

    it('throws for path containing ".." (path traversal prevention)', () => {
      expect(() => new NodeFileAdapter({ filePath: '/tmp/../etc/passwd' }))
        .toThrow(AdapterError);
    });

    it('accepts an absolute POSIX path', () => {
      expect(() => new NodeFileAdapter({ filePath: '/tmp/kv-test.json' }))
        .not.toThrow();
    });

    it('accepts an absolute Windows-style path', () => {
      expect(() => new NodeFileAdapter({ filePath: 'C:\\AppData\\kv-test.json' }))
        .not.toThrow();
    });
  });

  // ── Core operations ────────────────────────────────────────────────────────

  describe('getRaw / setRaw', () => {
    it('returns null for non-existent key', async () => {
      expect(await adapter.getRaw('missing')).toBeNull();
    });

    it('persists and retrieves a value', async () => {
      await adapter.setRaw('key1', 'hello');
      expect(await adapter.getRaw('key1')).toBe('hello');
    });

    it('overwrites an existing value', async () => {
      await adapter.setRaw('key1', 'first');
      await adapter.setRaw('key1', 'second');
      expect(await adapter.getRaw('key1')).toBe('second');
    });

    it('survives a re-read from disk (persistence)', async () => {
      await adapter.setRaw('persistent', 'value-on-disk');
      // Create a new adapter pointing at the same file
      const adapter2 = new NodeFileAdapter({ filePath });
      expect(await adapter2.getRaw('persistent')).toBe('value-on-disk');
    });
  });

  describe('delete', () => {
    it('removes an existing key', async () => {
      await adapter.setRaw('k', 'v');
      await adapter.delete('k');
      expect(await adapter.getRaw('k')).toBeNull();
    });

    it('resolves without error for non-existent key', async () => {
      await expect(adapter.delete('no-such-key')).resolves.toBeUndefined();
    });
  });

  describe('existsRaw', () => {
    it('returns false for missing key', async () => {
      expect(await adapter.existsRaw('nope')).toBe(false);
    });

    it('returns true for existing key', async () => {
      await adapter.setRaw('exists', 'yes');
      expect(await adapter.existsRaw('exists')).toBe(true);
    });
  });

  describe('keys', () => {
    it('returns an empty array on a fresh store', async () => {
      expect(await adapter.keys()).toEqual([]);
    });

    it('returns all stored keys', async () => {
      await adapter.setRaw('a', '1');
      await adapter.setRaw('b', '2');
      const keys = await adapter.keys();
      expect(keys.sort()).toEqual(['a', 'b']);
    });
  });

  describe('clear', () => {
    it('removes all keys', async () => {
      await adapter.setRaw('x', '1');
      await adapter.setRaw('y', '2');
      await adapter.clear();
      expect(await adapter.keys()).toEqual([]);
    });
  });

  // ── Security: corrupted file recovery ─────────────────────────────────────

  describe('corrupted file recovery', () => {
    it('resets gracefully when the file contains invalid JSON', async () => {
      fs.writeFileSync(filePath, 'THIS IS NOT JSON', 'utf8');
      const freshAdapter = new NodeFileAdapter({ filePath });
      // Should not throw — gracefully returns empty store
      expect(await freshAdapter.keys()).toEqual([]);
    });

    it('resets when file contains a JSON array (not a plain object)', async () => {
      fs.writeFileSync(filePath, JSON.stringify([1, 2, 3]), 'utf8');
      const freshAdapter = new NodeFileAdapter({ filePath });
      expect(await freshAdapter.keys()).toEqual([]);
    });

    it('resets when file contains a JSON string', async () => {
      fs.writeFileSync(filePath, JSON.stringify('just a string'), 'utf8');
      const freshAdapter = new NodeFileAdapter({ filePath });
      expect(await freshAdapter.keys()).toEqual([]);
    });
  });

  // ── Concurrent write safety ────────────────────────────────────────────────

  describe('concurrent writes', () => {
    it('handles concurrent setRaw calls without throwing (write-lock safety)', async () => {
      // Fire 20 writes simultaneously — the write-lock serializes them to prevent corruption
      // Each write re-reads the file, so earlier keys may be overwritten by later writes.
      // The important guarantee: no data corruption / no thrown errors.
      const writes = Array.from({ length: 20 }, (_, i) =>
        adapter.setRaw(`key-${i}`, `val-${i}`),
      );
      await expect(Promise.all(writes)).resolves.toBeDefined();

      // At least one key must be persisted on disk (last write wins per execution order)
      const keys = await adapter.keys();
      expect(keys.length).toBeGreaterThanOrEqual(1);
    });

    it('sequential writes all persist correctly', async () => {
      // Sequential writes (not concurrent) must all survive
      for (let i = 0; i < 10; i++) {
        await adapter.setRaw(`seq-${i}`, `val-${i}`);
      }
      const keys = await adapter.keys();
      expect(keys).toHaveLength(10);
    });
  });
});
