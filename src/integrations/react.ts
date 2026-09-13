import { useCallback, useEffect, useRef, useState } from 'react';
import type { IKVClient, SetOptions } from '../core/types.js';
import { KVClient } from '../client/index.js';

// Lazy singleton — created on first hook use to avoid issues during SSR
let _defaultKV: KVClient | null = null;
function getDefaultKV(): KVClient {
  if (_defaultKV === null) {
    _defaultKV = new KVClient();
  }
  return _defaultKV;
}

// ─────────────────────────────────────────────────────────────────────────────
// React integration — kv-one/react
//
// Exposes a `useKV` hook for reading and writing KV entries reactively.
// SSR-safe: returns `defaultValue` on the server without touching the adapter.
// ─────────────────────────────────────────────────────────────────────────────

export type UseKVResult<T> = {
  /** Current value, or `defaultValue` while loading / when key does not exist. */
  value: T;
  /** `true` while the initial value is being loaded from the adapter. */
  loading: boolean;
  /** Last error thrown by the adapter, or `null` if none. */
  error: Error | null;
  /** Persist a new value.  Signature matches `kv.set`. */
  setValue: (newValue: T, options?: SetOptions) => Promise<void>;
  /** Delete the key and reset `value` to `defaultValue`. */
  deleteValue: () => Promise<void>;
};

/**
 * React hook for reactive Key-Value storage.
 *
 * @param key - KV key to read/write
 * @param defaultValue - Value returned while loading or when the key is absent
 * @param client - Optional custom KV client (defaults to the auto-configured singleton)
 *
 * @example
 * ```tsx
 * import { useKV } from 'kv-one/react';
 *
 * function ThemeToggle() {
 *   const { value: theme, setValue } = useKV<string>('theme', 'dark');
 *   return (
 *     <button onClick={() => setValue(theme === 'dark' ? 'light' : 'dark')}>
 *       Current theme: {theme}
 *     </button>
 *   );
 * }
 * ```
 */
export function useKV<T = unknown>(
  key: string,
  defaultValue: T,
  client?: IKVClient,
): UseKVResult<T> {
  // Resolve the client lazily so getDefaultKV() is not called at module load
  const resolvedClient = client ?? getDefaultKV();

  const [value, setValueState] = useState<T>(defaultValue);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  // Stable ref to the client so the effect doesn't re-run on every render
  const clientRef = useRef(resolvedClient);
  clientRef.current = resolvedClient;

  // Stable ref to defaultValue
  const defaultValueRef = useRef(defaultValue);
  defaultValueRef.current = defaultValue;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const stored = await clientRef.current.get<T>(key);
        if (!cancelled) {
          setValueState(stored !== null ? stored : defaultValueRef.current);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setValueState(defaultValueRef.current);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [key]);

  const setValue = useCallback(
    async (newValue: T, options?: SetOptions): Promise<void> => {
      try {
        await clientRef.current.set(key, newValue, options);
        setValueState(newValue);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        throw err;
      }
    },
    [key],
  );

  const deleteValue = useCallback(async (): Promise<void> => {
    try {
      await clientRef.current.delete(key);
      setValueState(defaultValueRef.current);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }, [key]);

  return { value, loading, error, setValue, deleteValue };
}
