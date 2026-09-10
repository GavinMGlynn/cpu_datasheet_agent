import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CacheError } from './key.js';
import { CacheMeta, FileCacheStore, sha256Of } from './store.js';

const HASH = 'ab'.repeat(32);
const REF = { namespace: 'pdf', hash: HASH };

let root: string;
let store: FileCacheStore;

function metaFor(bytes: Buffer, overrides: Partial<CacheMeta> = {}): CacheMeta {
  return {
    createdAt: '2026-09-10T00:00:00Z',
    contentType: 'application/pdf',
    size: bytes.length,
    sha256: sha256Of(bytes),
    ...overrides,
  };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'cache-'));
  store = new FileCacheStore(path.join(root, 'cache'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('CacheMeta', () => {
  it('accepts full and minimal metadata', () => {
    const bytes = Buffer.from('x');
    expect(CacheMeta.safeParse(metaFor(bytes)).success).toBe(true);
    expect(
      CacheMeta.safeParse(
        metaFor(bytes, { ttlSeconds: 60, sourceUrl: 'https://example.com/x.pdf' }),
      ).success,
    ).toBe(true);
  });

  it.each([
    ['a negative ttl', { ttlSeconds: -1 }],
    ['a bad url', { sourceUrl: 'x' }],
    ['a bad digest', { sha256: 'nope' }],
    ['an empty content type', { contentType: ' ' }],
    ['an extra key', { extra: 1 } as Partial<CacheMeta>],
  ])('rejects %s', (_label, overrides) => {
    expect(CacheMeta.safeParse(metaFor(Buffer.from('x'), overrides)).success).toBe(false);
  });
});

describe('FileCacheStore paths', () => {
  it('shards by the first two byte pairs of the hash under the namespace', () => {
    expect(store.dataPath(REF)).toBe(path.join(root, 'cache', 'pdf', 'ab', 'ab', HASH));
    expect(store.metaPath(REF)).toBe(
      `${path.join(root, 'cache', 'pdf', 'ab', 'ab', HASH)}.meta.json`,
    );
    expect(store.root).toBe(path.join(root, 'cache'));
  });

  it('rejects an invalid namespace', () => {
    expect(() => store.dataPath({ namespace: 'Bad', hash: HASH })).toThrow(CacheError);
  });
});

describe('FileCacheStore round trip', () => {
  it('stores and returns bytes with metadata, creating directories as needed', async () => {
    const bytes = Buffer.from('%PDF-1.4 hello');
    const meta = metaFor(bytes, { ttlSeconds: 10, sourceUrl: 'https://example.com/a.pdf' });

    await expect(store.has(REF)).resolves.toBe(false);
    await store.put(REF, bytes, meta);

    await expect(store.has(REF)).resolves.toBe(true);
    await expect(store.stat(REF)).resolves.toEqual(meta);
    const entry = await store.get(REF);
    expect(entry?.meta).toEqual(meta);
    expect(entry?.bytes.equals(bytes)).toBe(true);
    expect(await readdir(path.dirname(store.dataPath(REF)))).toEqual([HASH, `${HASH}.meta.json`]);
  });

  it('overwrites an existing entry atomically and leaves no temporary files', async () => {
    const first = Buffer.from('one');
    const second = Buffer.from('two-longer');
    await store.put(REF, first, metaFor(first));
    await store.put(REF, second, metaFor(second));

    expect((await store.get(REF))?.bytes.toString()).toBe('two-longer');
    expect(await readdir(path.dirname(store.dataPath(REF)))).toEqual([HASH, `${HASH}.meta.json`]);
  });

  it('deletes both files and reports whether anything was removed', async () => {
    const bytes = Buffer.from('x');
    await store.put(REF, bytes, metaFor(bytes));

    await expect(store.delete(REF)).resolves.toBe(true);
    await expect(store.delete(REF)).resolves.toBe(false);
    await expect(store.get(REF)).resolves.toBeUndefined();
  });

  it('reports removal when only one of the two files was present', async () => {
    await mkdir(path.dirname(store.dataPath(REF)), { recursive: true });
    await writeFile(store.dataPath(REF), 'orphan');
    await expect(store.delete(REF)).resolves.toBe(true);
  });
});

describe('FileCacheStore corruption handling', () => {
  async function seed(bytes = Buffer.from('payload')): Promise<CacheMeta> {
    const meta = metaFor(bytes);
    await store.put(REF, bytes, meta);
    return meta;
  }

  it('treats an unparseable sidecar as a miss and removes the entry', async () => {
    await seed();
    await writeFile(store.metaPath(REF), '{not json', 'utf8');

    await expect(store.stat(REF)).resolves.toBeUndefined();
    await expect(stat(store.dataPath(REF))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('treats a schema-invalid sidecar as a miss and removes the entry', async () => {
    await seed();
    await writeFile(store.metaPath(REF), JSON.stringify({ createdAt: 'yesterday' }), 'utf8');

    await expect(store.get(REF)).resolves.toBeUndefined();
    await expect(stat(store.dataPath(REF))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('treats a sidecar without data as a miss and removes the sidecar', async () => {
    await seed();
    await rm(store.dataPath(REF));

    await expect(store.has(REF)).resolves.toBe(true);
    await expect(store.get(REF)).resolves.toBeUndefined();
    await expect(stat(store.metaPath(REF))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('treats a size mismatch as a miss', async () => {
    await seed();
    await writeFile(store.dataPath(REF), 'payload-changed');

    await expect(store.get(REF)).resolves.toBeUndefined();
    await expect(store.has(REF)).resolves.toBe(false);
  });

  it('treats a digest mismatch with matching size as a miss', async () => {
    await seed(Buffer.from('payload'));
    await writeFile(store.dataPath(REF), 'PAYLOAD');

    await expect(store.get(REF)).resolves.toBeUndefined();
  });
});

describe('FileCacheStore I/O failures', () => {
  it('wraps a metadata read failure that is not a missing file', async () => {
    await mkdir(store.metaPath(REF), { recursive: true });

    await expect(store.stat(REF)).rejects.toMatchObject({
      code: 'CACHE_IO',
      details: { path: store.metaPath(REF) },
    });
  });

  it('wraps a data read failure that is not a missing file', async () => {
    const bytes = Buffer.from('x');
    await store.put(REF, bytes, metaFor(bytes));
    await rm(store.dataPath(REF));
    await mkdir(store.dataPath(REF));

    await expect(store.get(REF)).rejects.toMatchObject({
      code: 'CACHE_IO',
      details: { path: store.dataPath(REF) },
    });
  });

  it('wraps a write failure and removes its temporary files', async () => {
    await writeFile(path.join(root, 'cache'), 'a file where the root should be');
    const bytes = Buffer.from('x');

    await expect(store.put(REF, bytes, metaFor(bytes))).rejects.toMatchObject({ code: 'CACHE_IO' });
  });

  it('wraps a delete failure that is not a missing file', async () => {
    await mkdir(path.join(store.dataPath(REF), 'child'), { recursive: true });

    await expect(store.delete(REF)).rejects.toMatchObject({
      code: 'CACHE_IO',
      details: { path: store.dataPath(REF) },
    });
  });
});
