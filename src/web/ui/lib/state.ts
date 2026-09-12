import { useCallback, useEffect, useRef, useState } from 'react';

import type { ApiError } from './api.js';

/**
 * A thrown value as an error, since a runtime can throw anything.
 *
 * Exported for its own test: writing a promise that rejects with a string is
 * exactly what the lint rules forbid, and the behaviour is worth pinning
 * anyway.
 */
export function asError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

/**
 * Loading something from the server, as a hook.
 *
 * Three states, and all three are rendered: loading, failed with the code the
 * server sent, and loaded — including loaded-but-empty, which is a real
 * answer and not a blank page.
 */

export type AsyncState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly error: ApiError | Error }
  | { readonly status: 'loaded'; readonly value: T };

export interface AsyncResult<T> {
  readonly state: AsyncState<T>;
  /** Runs the load again, for a refresh button or after a write. */
  reload(): void;
}

/**
 * `key` is what identifies the question being asked — the path and the
 * filters, as one string. A deps array would need a spread here, which no
 * static check can follow; a key is a thing the caller can state exactly.
 */
export function useAsync<T>(key: string, load: () => Promise<T>): AsyncResult<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);
  const alive = useRef(true);
  const loader = useRef(load);
  loader.current = load;

  useEffect(() => {
    alive.current = true;
    setState({ status: 'loading' });
    loader
      .current()
      .then((value) => {
        if (alive.current) {
          setState({ status: 'loaded', value });
        }
      })
      .catch((error: unknown) => {
        if (alive.current) {
          setState({
            status: 'failed',
            error: asError(error),
          });
        }
      });
    return () => {
      // The component went away, or the question changed: whatever comes back
      // now belongs to a question nobody is asking any more.
      alive.current = false;
    };
  }, [key, nonce]);

  const reload = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  return { state, reload };
}

/** A value kept in the browser, so a choice survives a reload. */
export function useStored(key: string, fallback: string): [string, (value: string) => void] {
  const [value, setValue] = useState(() => {
    try {
      return globalThis.localStorage.getItem(key) ?? fallback;
    } catch {
      // Private windows and blocked storage: the default is a fine answer.
      return fallback;
    }
  });
  const store = useCallback(
    (next: string) => {
      setValue(next);
      try {
        globalThis.localStorage.setItem(key, next);
      } catch {
        // Nothing to do: the choice holds for this page and not beyond it.
      }
    },
    [key],
  );
  return [value, store];
}
