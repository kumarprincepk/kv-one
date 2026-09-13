# kv-one

> A runtime-adaptive, framework-agnostic Key-Value store for Browser, Node.js, and Cloudflare Workers — **one API everywhere**.

[![npm version](https://img.shields.io/npm/v/kv-one.svg)](https://www.npmjs.com/package/kv-one)
[![bundle size](https://img.shields.io/bundlephobia/minzip/kv-one)](https://bundlephobia.com/package/kv-one)
[![license](https://img.shields.io/npm/l/kv-one.svg)](LICENSE)
[![test coverage](https://img.shields.io/badge/coverage->95%25-brightgreen)]()

---

## The Problem

```ts
// ❌ You've written this boilerplate a hundred times:
const get = (key: string) => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(key);
  } else if (isCloudflareWorker) {
    return env.MY_KV.get(key);
  } else {
    return memoryMap.get(key) ?? null;
  }
};
```

## The Solution

```ts
// ✅ One API. Any runtime.
import { kv } from 'kv-one';

await kv.set('user', { name: 'Alice' }, { ttl: 3600 });
const user = await kv.get<User>('user');
```

---

## Features

- 🌍 **Runtime-adaptive** — auto-detects Browser, Node.js, and Cloudflare Workers
- 🔑 **TTL support** — uniform expiry across all adapters (no per-adapter differences)
- 📦 **Namespacing** — `kv.namespace('module')` prevents key collisions
- ⚡ **Zero runtime dependencies** — < 4 KB minified + gzipped
- 🔒 **Security-first** — prototype-pollution blocked, key validation, circular-reference detection
- 🧩 **Framework-agnostic** — optional `kv-one/react` hook included
- 🏭 **Production-ready** — fully typed, >95% test coverage

---

## Installation

```bash
npm install kv-one
```

---

## Quick Start

### Auto-configured Singleton (most common)

```ts
import { kv } from 'kv-one';

// Store any JSON-serializable value
await kv.set('theme', 'dark');
await kv.set('user', { id: 1, name: 'Alice' });
await kv.set('session', token, { ttl: 3600 }); // expires in 1 hour

// Retrieve
const theme = await kv.get<string>('theme');   // 'dark'
const user = await kv.get<User>('user');        // { id: 1, name: 'Alice' }
const gone = await kv.get('missing');           // null

// Check existence
await kv.has('theme');   // true

// Delete
await kv.delete('theme');

// List all non-expired keys
await kv.keys();         // ['user', 'session', ...]

// List all entries
await kv.entries<unknown>();  // [['user', {...}], ['session', '...'], ...]

// Clear everything
await kv.clear();
```

### Namespacing

```ts
const userKV = kv.namespace('users');
const sessionKV = kv.namespace('sessions');

await userKV.set('alice', { role: 'admin' });
await sessionKV.set('alice', { token: 'xyz' });

// No collision — stored as 'users:alice' and 'sessions:alice'
await userKV.get('alice');    // { role: 'admin' }
await sessionKV.get('alice'); // { token: 'xyz' }

// Nested namespacing
const adminKV = kv.namespace('users').namespace('admin');
await adminKV.set('config', { maxRoles: 5 });
// Stored as 'users:admin:config'
```

### Custom Adapter (e.g. Cloudflare Workers)

```ts
import { createKV, CloudflareAdapter } from 'kv-one';

export default {
  async fetch(request: Request, env: Env) {
    const store = createKV({
      adapter: new CloudflareAdapter({ namespace: env.MY_KV }),
    });

    await store.set('visits', count, { ttl: 86400 });
    const visits = await store.get<number>('visits');
  }
};
```

### Manual Adapter

```ts
import { createKV, MemoryAdapter, LocalStorageAdapter } from 'kv-one';

// In-memory (great for tests)
const store = createKV({ adapter: new MemoryAdapter() });

// Explicit localStorage
const browserStore = createKV({ adapter: new LocalStorageAdapter() });
```

---

## React Integration

```bash
# No extra install needed — React is an optional peer dependency
```

```tsx
import { useKV } from 'kv-one/react';

function ThemeToggle() {
  const { value: theme, setValue, loading } = useKV<string>('theme', 'dark');

  if (loading) return <span>Loading...</span>;

  return (
    <button onClick={() => setValue(theme === 'dark' ? 'light' : 'dark')}>
      Current theme: {theme}
    </button>
  );
}
```

### `useKV` API

| Property | Type | Description |
|---|---|---|
| `value` | `T` | Current value, or `defaultValue` while loading |
| `loading` | `boolean` | `true` during initial load |
| `error` | `Error \| null` | Last adapter error |
| `setValue` | `(v: T, opts?: SetOptions) => Promise<void>` | Persist a new value |
| `deleteValue` | `() => Promise<void>` | Delete the key |

---

## Runtime Adapter Matrix

| Runtime | Auto-detected | Default Adapter | Notes |
|---|---|---|---|
| Browser | ✅ | `LocalStorageAdapter` | Falls back to `MemoryAdapter` in private mode |
| Node.js | ✅ | `MemoryAdapter` | In-process, cleared on restart |
| Cloudflare Workers | ⚠️ | — | Pass `CloudflareAdapter` explicitly |
| SSR / Edge | ✅ | `MemoryAdapter` | Safe fallback |
| Test / CI | ✅ | `MemoryAdapter` | Use `createKV({ adapter: new MemoryAdapter() })` |

---

## TTL Behaviour

TTL is **uniform across all adapters** — implemented at the library layer, not delegated to native adapter features. Every value is stored as:

```json
{ "v": <your-value>, "exp": <unix-ms-timestamp-or-null> }
```

- Expiry is **checked on every `get()`** — expired entries return `null`
- Expired entries are **lazily deleted** on read (no background sweeps)
- `keys()` and `entries()` **filter out expired entries**

```ts
await kv.set('code', '123456', { ttl: 300 }); // 5 minutes
// ... 6 minutes later ...
await kv.get('code'); // null — expired and auto-deleted
```

---

## Security

| Threat | Mitigation |
|---|---|
| **XSS via localStorage** | Values serialized via controlled JSON; no `eval` or `innerHTML` |
| **Prototype Pollution** | JSON deserializer uses a reviver blocking `__proto__`, `constructor`, `prototype` |
| **Storage Quota DoS** | `QuotaExceededError` caught and surfaced as `KVError` — never swallowed |
| **Key Injection** | Keys validated against `/^[a-zA-Z0-9\-_:.]+$/` — invalid keys throw `KeyValidationError` |
| **Circular References** | Serializer detects and throws `SerializationError` |
| **TTL Bypass** | Expiry checked server-side at read time, not only at write time |

---

## Error Handling

All errors extend the base `KVError` class and carry a `code` string:

```ts
import { KVError, KeyValidationError, TTLError, SerializationError } from 'kv-one';

try {
  await kv.set('bad key!', 'value'); // throws KeyValidationError
} catch (err) {
  if (err instanceof KVError) {
    console.error(err.code);    // 'KEY_INVALID'
    console.error(err.message); // Human-readable message
  }
}
```

| Class | Code | When |
|---|---|---|
| `KVError` | — | Base class |
| `AdapterNotFoundError` | `ADAPTER_NOT_FOUND` | No adapter auto-detected (e.g. CF Workers without explicit adapter) |
| `AdapterError` | `ADAPTER_ERROR` | Storage quota, permission denied, etc. |
| `SerializationError` | `SERIALIZATION_ERROR` | Circular refs, invalid JSON, malformed envelopes |
| `TTLError` | `TTL_INVALID` | Non-positive or non-integer TTL |
| `KeyValidationError` | `KEY_INVALID` | Empty or illegal characters in key |
| `UnsupportedOperationError` | `UNSUPPORTED_OPERATION` | Adapter doesn't support an operation |

---

## API Reference

### `kv` (singleton)

Auto-configured KV client. Adapter is resolved lazily on first use.

### `createKV(options?): KVClient`

Create an independent KV client instance.

```ts
const store = createKV({
  adapter?: IKVAdapter,   // Custom adapter
  prefix?: string,        // Global key prefix
});
```

### `KVClient` methods

| Method | Signature | Description |
|---|---|---|
| `get` | `<T>(key) → Promise<T \| null>` | Get a value (null if missing or expired) |
| `set` | `<T>(key, value, opts?) → Promise<void>` | Store a value with optional TTL |
| `delete` | `(key) → Promise<void>` | Remove a key |
| `has` | `(key) → Promise<boolean>` | Check non-expired existence |
| `clear` | `() → Promise<void>` | Remove all keys (namespace-scoped) |
| `keys` | `() → Promise<string[]>` | List non-expired keys |
| `entries` | `<T>() → Promise<[string, T][]>` | List non-expired key-value pairs |
| `namespace` | `(prefix) → KVClient` | Create a namespaced sub-client |

---

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Build
npm run build

# Type check
npm run typecheck

# Lint
npm run lint
```

---

## License

MIT
# kv-one
