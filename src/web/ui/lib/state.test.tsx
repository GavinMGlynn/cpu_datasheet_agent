// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '../../../../test/ui/render.js';
import { ApiError } from './api.js';
import { asError, useAsync, useStored } from './state.js';

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.localStorage.clear();
});

describe('useAsync', () => {
  it('loads, then holds the value', async () => {
    const { result } = renderHook(() => useAsync('one', () => Promise.resolve(42)));
    expect(result.current.state.status).toBe('loading');
    await waitFor(() => {
      expect(result.current.state).toStrictEqual({ status: 'loaded', value: 42 });
    });
  });

  it('keeps the failure the server sent', async () => {
    const { result } = renderHook(() =>
      useAsync('two', () => Promise.reject(new ApiError(404, 'DB_PART_NOT_FOUND', 'no such part'))),
    );
    await waitFor(() => {
      expect(result.current.state.status).toBe('failed');
    });
    const state = result.current.state;
    expect(state.status === 'failed' && state.error instanceof ApiError && state.error.code).toBe(
      'DB_PART_NOT_FOUND',
    );
  });

  it('turns anything else thrown into an error', async () => {
    const { result } = renderHook(() => useAsync('three', () => Promise.reject(new Error('nope'))));
    await waitFor(() => {
      expect(result.current.state.status).toBe('failed');
    });
  });

  it('asks again when the key changes', async () => {
    const load = vi.fn((key: string) => Promise.resolve(key));
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useAsync(key, () => load(key)),
      { initialProps: { key: 'a' } },
    );
    await waitFor(() => {
      expect(result.current.state.status).toBe('loaded');
    });
    rerender({ key: 'b' });
    await waitFor(() => {
      expect(result.current.state).toStrictEqual({ status: 'loaded', value: 'b' });
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('asks again when told to reload', async () => {
    let calls = 0;
    const { result } = renderHook(() =>
      useAsync('five', () => {
        calls += 1;
        return Promise.resolve(calls);
      }),
    );
    await waitFor(() => {
      expect(result.current.state.status).toBe('loaded');
    });
    act(() => {
      result.current.reload();
    });
    await waitFor(() => {
      expect(result.current.state).toStrictEqual({ status: 'loaded', value: 2 });
    });
  });

  it('drops an answer that arrives after the component has gone', async () => {
    let settle: (value: number) => void = () => undefined;
    const { unmount } = renderHook(() =>
      useAsync(
        'six',
        () =>
          new Promise<number>((resolve) => {
            settle = resolve;
          }),
      ),
    );
    unmount();
    act(() => {
      settle(1);
    });
    await Promise.resolve();
  });

  it('drops a failure that arrives after the component has gone', async () => {
    let fail: (error: Error) => void = () => undefined;
    const { unmount } = renderHook(() =>
      useAsync(
        'seven',
        () =>
          new Promise<number>((_resolve, reject) => {
            fail = reject;
          }),
      ),
    );
    unmount();
    act(() => {
      fail(new Error('too late'));
    });
    await Promise.resolve();
  });
});

describe('asError', () => {
  it('passes an error through and wraps anything else that was thrown', () => {
    const error = new Error('the store said no');
    expect(asError(error)).toBe(error);
    expect(asError('a string').message).toBe('a string');
    expect(asError(undefined).message).toBe('undefined');
  });
});

describe('useStored', () => {
  it('remembers a choice across renders', () => {
    const { result } = renderHook(() => useStored('chip:test', 'live'));
    expect(result.current[0]).toBe('live');
    act(() => {
      result.current[1]('run-a');
    });
    expect(result.current[0]).toBe('run-a');
    expect(globalThis.localStorage.getItem('chip:test')).toBe('run-a');
  });

  it('reads a choice made earlier', () => {
    globalThis.localStorage.setItem('chip:test', 'run-b');
    const { result } = renderHook(() => useStored('chip:test', 'live'));
    expect(result.current[0]).toBe('run-b');
  });

  it('works where storage is refused', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      clear: () => undefined,
    });
    const { result } = renderHook(() => useStored('chip:test', 'live'));
    expect(result.current[0]).toBe('live');
    act(() => {
      result.current[1]('run-c');
    });
    expect(result.current[0]).toBe('run-c');
  });
});
