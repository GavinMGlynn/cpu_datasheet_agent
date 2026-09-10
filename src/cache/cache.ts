import type { Codec } from './codec.js';
import { refOf, type CacheKey } from './key.js';
import { sha256Of, type CacheMeta, type CacheStore } from './store.js';

export interface FetchResult<T> {
  readonly value: T;
  readonly contentType?: string;
  readonly sourceUrl?: string;
}

export interface CachedOptions<T> {
  readonly codec: Codec<T>;
  /** Entries older than this are refetched. Omit for entries that never expire. */
  readonly ttlSeconds?: number;
  /** Bypass the stored entry and overwrite it. */
  readonly force?: boolean;
  /** Content type recorded when the fetch result does not supply one. */
  readonly contentType?: string;
}

export interface CachedResult<T> {
  readonly value: T;
  /** Hex SHA-256 of the key; the `cacheKey` used in distributor provenance. */
  readonly hash: string;
  /** True when served from the store without calling `fetch`. */
  readonly hit: boolean;
  readonly meta: CacheMeta;
}

export interface CacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly expired: number;
  readonly forced: number;
  /** Calls that joined an in-flight fetch for the same key. */
  readonly joined: number;
}

export interface CacheOptions {
  readonly store: CacheStore;
  readonly clock?: () => Date;
}

export function isExpired(meta: CacheMeta, now: Date): boolean {
  return (
    meta.ttlSeconds !== undefined &&
    Date.parse(meta.createdAt) + meta.ttlSeconds * 1000 <= now.getTime()
  );
}

/**
 * The single seam between the deterministic layer and the network. Every
 * remote call goes through `cached`, so a rerun with a warm store makes no
 * requests, and swapping the store swaps where the bytes live.
 */
export class Cache {
  private readonly store: CacheStore;
  private readonly clock: () => Date;
  private readonly inflight = new Map<string, Promise<CachedResult<unknown>>>();
  private counters = { hits: 0, misses: 0, expired: 0, forced: 0, joined: 0 };

  constructor(options: CacheOptions) {
    this.store = options.store;
    this.clock = options.clock ?? ((): Date => new Date());
  }

  get stats(): CacheStats {
    return { ...this.counters };
  }

  resetStats(): void {
    this.counters = { hits: 0, misses: 0, expired: 0, forced: 0, joined: 0 };
  }

  /**
   * Returns the stored value for `key` when present and unexpired, otherwise
   * calls `fetch`, stores its result, and returns the stored form. Concurrent
   * calls for the same key share one fetch. The value returned after a fetch
   * is the decoded stored bytes, so the first run and every rerun see the
   * same thing.
   */
  cached<T>(
    key: CacheKey,
    fetch: () => Promise<FetchResult<T>>,
    options: CachedOptions<T>,
  ): Promise<CachedResult<T>> {
    const ref = refOf(key);
    const running = this.inflight.get(ref.hash);
    if (running !== undefined && options.force !== true) {
      this.counters.joined += 1;
      return running as Promise<CachedResult<T>>;
    }
    const promise = this.run(ref.hash, ref, fetch, options).finally(() => {
      if (this.inflight.get(ref.hash) === promise) {
        this.inflight.delete(ref.hash);
      }
    });
    this.inflight.set(ref.hash, promise);
    return promise;
  }

  private async run<T>(
    hash: string,
    ref: { namespace: string; hash: string },
    fetch: () => Promise<FetchResult<T>>,
    options: CachedOptions<T>,
  ): Promise<CachedResult<T>> {
    const { codec } = options;
    if (options.force === true) {
      this.counters.forced += 1;
    } else {
      const entry = await this.store.get(ref);
      if (entry === undefined) {
        this.counters.misses += 1;
      } else if (isExpired(entry.meta, this.clock())) {
        this.counters.expired += 1;
      } else {
        this.counters.hits += 1;
        return { value: codec.decode(entry.bytes), hash, hit: true, meta: entry.meta };
      }
    }
    const fetched = await fetch();
    const bytes = codec.encode(fetched.value);
    const meta: CacheMeta = {
      createdAt: this.clock().toISOString(),
      ...(options.ttlSeconds === undefined ? {} : { ttlSeconds: options.ttlSeconds }),
      contentType: fetched.contentType ?? options.contentType ?? codec.defaultContentType,
      ...(fetched.sourceUrl === undefined ? {} : { sourceUrl: fetched.sourceUrl }),
      size: bytes.length,
      sha256: sha256Of(bytes),
    };
    await this.store.put(ref, bytes, meta);
    return { value: codec.decode(bytes), hash, hit: false, meta };
  }
}
