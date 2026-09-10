# cache

Content-addressed cache (Module 3). Every network call in the deterministic
layer goes through `Cache.cached`, so a rerun with a warm store makes no
requests, and the store interface is the one seam to swap for S3 later.
Import from `src/cache/index.ts`.

## Keys (`key.ts`)

- `CacheKey` is `{ namespace, params }`. The namespace names the adapter or
  operation (`/^[a-z][a-z0-9_-]{0,63}$/`); `params` is plain JSON.
- `canonicalJson(value)` serialises deterministically: keys sorted at every
  level, no whitespace. Non-JSON input throws `CacheError`
  (`CACHE_PARAMS_NOT_JSON`).
- `hashCacheKey(key)` is the hex SHA-256 over the namespace, a newline, and
  the canonical params, so key order never matters and namespaces never
  collide. `refOf(key)` returns `{ namespace, hash }`, the store address.
  The hash is the `cacheKey` recorded in distributor provenance.

## Store (`store.ts`)

- `CacheStore` interface: `get`, `put`, `has`, `delete`, `stat`, all keyed by
  a `CacheRef`. Implementations treat a missing, corrupt, or mismatched entry
  as absent.
- `CacheMeta` sidecar: `createdAt`, optional `ttlSeconds`, `contentType`,
  optional `sourceUrl`, `size`, and the `sha256` of the stored bytes.
- `FileCacheStore(root)` lays entries out as
  `root/<namespace>/ab/cd/<hash>` plus `<hash>.meta.json`. Writes go to a
  temporary file in the same directory and are renamed into place. On read,
  a sidecar that is missing, unparseable, or schema-invalid, or bytes whose
  size or digest disagree with it, count as a miss and the entry is removed.
  Filesystem failures other than "not found" surface as `CacheError`
  (`CACHE_IO`) with the path in `details`.

## Codecs (`codec.ts`)

`jsonCodec<T>()`, `textCodec`, `bytesCodec`: each has `encode`, `decode`, and
a `defaultContentType`. The JSON codec's `decode` trusts the stored shape;
callers that need certainty validate with a schema.

## Cache (`cache.ts`)

`new Cache({ store, clock? })` then
`cached(key, fetch, { codec, ttlSeconds?, force?, contentType? })`:

- `fetch` returns `{ value, contentType?, sourceUrl? }`.
- Result is `{ value, hash, hit, meta }`. After a fetch the returned `value`
  is the decoded stored bytes, so the first run and every rerun see the same
  thing.
- An entry is expired when `createdAt + ttlSeconds` has been reached
  (`isExpired`); expired entries are refetched and overwritten. `force`
  skips the lookup and overwrites.
- Concurrent calls for the same key share one in-flight fetch. A forced call
  never joins; it starts its own fetch and becomes the flight later callers
  join.
- `stats` counts `hits`, `misses`, `expired`, `forced`, `joined`;
  `resetStats()` zeroes them.

The plan described a bare `cached()` function; the in-flight map and the
counters need state, so it is a method on `Cache`. Nothing else differs.
