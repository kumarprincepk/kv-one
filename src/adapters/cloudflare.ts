import { AdapterError } from '../core/errors.js';
import { BaseAdapter } from './base.js';

// ─────────────────────────────────────────────────────────────────────────────
// Cloudflare Workers KV Adapter
//
// Accepts a `KVNamespace` binding injected from the Worker environment.
// The binding is typed via the minimal interface below so callers don't need
// to install `@cloudflare/workers-types` just to use this adapter.
//
// TTL is NOT delegated to CF KV's native `expirationTtl` — it is managed
// uniformly in the core layer via the stored envelope, keeping behaviour
// identical across all adapters.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal interface for a Cloudflare Workers KV namespace binding.
 * Compatible with the actual `KVNamespace` type from `@cloudflare/workers-types`.
 */
export interface CFKVNamespace {
  get(key: string, options?: { type: 'text' }): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: Array<{ name: string }>;
    list_complete: boolean;
    cursor?: string;
  }>;
}

export interface CloudflareAdapterOptions {
  /**
   * The KV namespace binding passed from `env` in the Worker handler.
   *
   * @example
   * ```ts
   * export default {
   *   async fetch(request, env) {
   *     const kv = createKV({ adapter: new CloudflareAdapter({ namespace: env.MY_KV }) });
   *   }
   * }
   * ```
   */
  namespace: CFKVNamespace;
}

export class CloudflareAdapter extends BaseAdapter {
  readonly name = 'CloudflareAdapter';

  private readonly ns: CFKVNamespace;

  constructor({ namespace }: CloudflareAdapterOptions) {
    super();
    this.ns = namespace;
  }

  async getRaw(key: string): Promise<string | null> {
    try {
      return await this.ns.get(key, { type: 'text' });
    } catch (err) {
      throw new AdapterError(`Failed to get key "${key}" from Cloudflare KV.`, err);
    }
  }

  async setRaw(key: string, value: string): Promise<void> {
    try {
      await this.ns.put(key, value);
    } catch (err) {
      throw new AdapterError(`Failed to set key "${key}" in Cloudflare KV.`, err);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.ns.delete(key);
    } catch (err) {
      throw new AdapterError(`Failed to delete key "${key}" from Cloudflare KV.`, err);
    }
  }

  async existsRaw(key: string): Promise<boolean> {
    try {
      const val = await this.ns.get(key, { type: 'text' });
      return val !== null;
    } catch (err) {
      throw new AdapterError(`Failed to check existence of key "${key}" in Cloudflare KV.`, err);
    }
  }

  async clear(): Promise<void> {
    const allKeys = await this.keys();
    await Promise.all(allKeys.map((k) => this.delete(k)));
  }

  async keys(): Promise<string[]> {
    const result: string[] = [];
    let cursor: string | undefined;
    let complete = false;

    while (!complete) {
      try {
        const listOptions: { prefix?: string; limit: number; cursor?: string } = { limit: 1000 };
        if (cursor !== undefined) listOptions.cursor = cursor;
        const response = await this.ns.list(listOptions);
        for (const key of response.keys) {
          result.push(key.name);
        }
        complete = response.list_complete;
        cursor = response.cursor;
      } catch (err) {
        throw new AdapterError('Failed to list keys from Cloudflare KV.', err);
      }
    }

    return result;
  }
}
