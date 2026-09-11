import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Cache, CacheMissError, isExpired, type FetchResult } from './cache.js';
import { bytesCodec, jsonCodec, textCodec } from './codec.js';
import { hashCacheKey } from './key.js';
import { FileCacheStore, type CacheMeta } from './store.js';

const T0 = Date.parse('2026-09-10T10:00:00Z');
const KEY = { namespace: 'test', params: { id: 1 } };

let root: string;
let store: FileCacheStore;
let now: number;
let cache: Cache;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'cache-'));
  store = new FileCacheStore(root);
  now = T0;
  cache = new Cache({ store, clock: () => new Date(now) });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('isExpired', () => {
  const meta: CacheMeta = {
    createdAt: '2026-09-10T10:00:00Z',
    contentType: 'x',
    size: 0,
    sha256: 'a'.repeat(64),
  };

  it('never expires without a ttl', () => {
    expect(isExpired(meta, new Date('2099-01-01T00:00:00Z'))).toBe(false);
  });

  it('expires exactly at createdAt plus ttl', () => {
    const withTtl = { ...meta, ttlSeconds: 60 };
    expect(isExpired(withTtl, new Date(T0 + 59_999))).toBe(false);
    expect(isExpired(withTtl, new Date(T0 + 60_000))).toBe(true);
  });
});

describe('Cache.cached', () => {
  it('fetches on a miss, stores, and returns the decoded stored value', async () => {
    const fetch = vi.fn(() => Promise.resolve({ value: { a: 1, dropped: undefined } }));

    const result = await cache.cached(KEY, fetch, { codec: jsonCodec<{ a: number }>() });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      value: { a: 1 },
      hash: hashCacheKey(KEY),
      hit: false,
      meta: {
        createdAt: '2026-09-10T10:00:00.000Z',
        contentType: 'application/json',
        size: 7,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/) as string,
      },
    });
    expect(cache.stats).toEqual({ hits: 0, misses: 1, expired: 0, forced: 0, joined: 0 });
  });

  it('serves a hit without calling fetch', async () => {
    const fetch = vi.fn(() => Promise.resolve({ value: 'text' }));
    await cache.cached(KEY, fetch, { codec: textCodec });

    const second = await cache.cached(KEY, fetch, { codec: textCodec });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(second.hit).toBe(true);
    expect(second.value).toBe('text');
    expect(cache.stats).toMatchObject({ hits: 1, misses: 1 });
  });

  it('refetches once the ttl has passed', async () => {
    let n = 0;
    const fetch = (): Promise<FetchResult<number>> => Promise.resolve({ value: ++n });
    const options = { codec: jsonCodec<number>(), ttlSeconds: 30 };

    await cache.cached(KEY, fetch, options);
    now += 29_000;
    expect((await cache.cached(KEY, fetch, options)).value).toBe(1);
    now += 1_000;
    const refreshed = await cache.cached(KEY, fetch, options);

    expect(refreshed.value).toBe(2);
    expect(refreshed.hit).toBe(false);
    expect(refreshed.meta.ttlSeconds).toBe(30);
    expect(refreshed.meta.createdAt).toBe('2026-09-10T10:00:30.000Z');
    expect(cache.stats).toEqual({ hits: 1, misses: 1, expired: 1, forced: 0, joined: 0 });
  });

  it('bypasses and overwrites the entry when forced', async () => {
    const fetch = vi.fn(() => Promise.resolve({ value: Buffer.from('v') }));
    await cache.cached(KEY, fetch, { codec: bytesCodec });
    const get = vi.spyOn(store, 'get');

    const forced = await cache.cached(KEY, fetch, { codec: bytesCodec, force: true });

    expect(get).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(forced.hit).toBe(false);
    expect(cache.stats).toMatchObject({ forced: 1 });
  });

  it('records content type from the fetch result, then options, then the codec', async () => {
    const fromFetch = await cache.cached(
      { namespace: 'ct', params: 1 },
      () => Promise.resolve({ value: 'a', contentType: 'text/html' }),
      {
        codec: textCodec,
        contentType: 'text/csv',
      },
    );
    const fromOptions = await cache.cached(
      { namespace: 'ct', params: 2 },
      () => Promise.resolve({ value: 'a' }),
      {
        codec: textCodec,
        contentType: 'text/csv',
      },
    );
    const fromCodec = await cache.cached(
      { namespace: 'ct', params: 3 },
      () => Promise.resolve({ value: 'a' }),
      {
        codec: textCodec,
      },
    );

    expect(fromFetch.meta.contentType).toBe('text/html');
    expect(fromOptions.meta.contentType).toBe('text/csv');
    expect(fromCodec.meta.contentType).toBe('text/plain; charset=utf-8');
  });

  it('records the source url when the fetch supplies one', async () => {
    const result = await cache.cached(
      KEY,
      () => Promise.resolve({ value: 'a', sourceUrl: 'https://example.com/a' }),
      {
        codec: textCodec,
      },
    );
    expect(result.meta.sourceUrl).toBe('https://example.com/a');
  });

  it('shares one fetch between concurrent calls for the same key', async () => {
    const gate = deferred<FetchResult<string>>();
    const fetch = vi.fn(() => gate.promise);

    const first = cache.cached(KEY, fetch, { codec: textCodec });
    const second = cache.cached(KEY, fetch, { codec: textCodec });
    gate.resolve({ value: 'shared' });

    const results = await Promise.all([first, second]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(results[0]).toBe(results[1]);
    expect(results[0].value).toBe('shared');
    expect(cache.stats).toMatchObject({ misses: 1, joined: 1 });

    const later = await cache.cached(KEY, fetch, { codec: textCodec });
    expect(later.hit).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not join an in-flight fetch when forced, and keeps the newer flight registered', async () => {
    const slow = deferred<FetchResult<string>>();
    const fast = deferred<FetchResult<string>>();
    const first = cache.cached(KEY, () => slow.promise, { codec: textCodec });
    const forced = cache.cached(KEY, () => fast.promise, { codec: textCodec, force: true });

    slow.resolve({ value: 'slow' });
    await first;
    const joiner = cache.cached(KEY, () => Promise.resolve({ value: 'never' }), {
      codec: textCodec,
    });
    fast.resolve({ value: 'fast' });

    expect((await forced).value).toBe('fast');
    expect((await joiner).value).toBe('fast');
    expect(cache.stats).toMatchObject({ misses: 1, forced: 1, joined: 1 });
  });

  it('propagates a fetch failure and lets the next call try again', async () => {
    const failing = vi.fn(() => Promise.reject(new Error('network down')));
    await expect(cache.cached(KEY, failing, { codec: textCodec })).rejects.toThrow('network down');

    const ok = await cache.cached(KEY, () => Promise.resolve({ value: 'recovered' }), {
      codec: textCodec,
    });
    expect(ok.value).toBe('recovered');
    expect(cache.stats).toMatchObject({ misses: 2, joined: 0 });
  });

  it('keeps namespaces apart', async () => {
    await cache.cached({ namespace: 'a', params: 1 }, () => Promise.resolve({ value: 'A' }), {
      codec: textCodec,
    });
    const other = await cache.cached(
      { namespace: 'b', params: 1 },
      () => Promise.resolve({ value: 'B' }),
      { codec: textCodec },
    );
    expect(other.value).toBe('B');
    expect(other.hit).toBe(false);
  });

  it('round-trips binary content', async () => {
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);
    await cache.cached(KEY, () => Promise.resolve({ value: bytes }), { codec: bytesCodec });
    const hit = await cache.cached(KEY, () => Promise.reject(new Error('should not fetch')), {
      codec: bytesCodec,
    });
    expect(hit.value.equals(bytes)).toBe(true);
    expect(hit.meta.size).toBe(6);
  });

  describe('cacheOnly', () => {
    it('serves a stored entry without fetching', async () => {
      await cache.cached(KEY, () => Promise.resolve({ value: 'stored' }), { codec: textCodec });
      const fetch = vi.fn(() => Promise.resolve({ value: 'fresh' }));

      const result = await cache.cached(KEY, fetch, { codec: textCodec, cacheOnly: true });

      expect(result.value).toBe('stored');
      expect(result.hit).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('throws CACHE_MISS rather than fetching when nothing is stored', async () => {
      const fetch = vi.fn(() => Promise.resolve({ value: 'fresh' }));

      await expect(
        cache.cached(KEY, fetch, { codec: textCodec, cacheOnly: true }),
      ).rejects.toMatchObject({ code: 'CACHE_MISS' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('throws CACHE_MISS for an expired entry', async () => {
      await cache.cached(KEY, () => Promise.resolve({ value: 'stale' }), {
        codec: textCodec,
        ttlSeconds: 60,
      });
      now = T0 + 61_000;

      await expect(
        cache.cached(KEY, () => Promise.resolve({ value: 'fresh' }), {
          codec: textCodec,
          cacheOnly: true,
        }),
      ).rejects.toMatchObject({ code: 'CACHE_MISS' });
    });

    it('refuses to be combined with force', () => {
      expect(() =>
        cache.cached(KEY, () => Promise.resolve({ value: 'x' }), {
          codec: textCodec,
          cacheOnly: true,
          force: true,
        }),
      ).toThrow(CacheMissError);
    });
  });

  it('resets statistics', () => {
    cache.resetStats();
    expect(cache.stats).toEqual({ hits: 0, misses: 0, expired: 0, forced: 0, joined: 0 });
  });

  it('uses the real clock by default', async () => {
    const before = Date.now();
    const real = new Cache({ store });
    const result = await real.cached(KEY, () => Promise.resolve({ value: 'x' }), {
      codec: textCodec,
    });
    expect(Date.parse(result.meta.createdAt)).toBeGreaterThanOrEqual(before - 1000);
  });
});
