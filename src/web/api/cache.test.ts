import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestApi, type TestApi } from '../../../test/helpers/web-api.js';
import { entriesOf, namespacesOf, registerCache } from './cache.js';

let api: TestApi;

async function cacheEntry(namespace: string, hash: string, bytes: string): Promise<void> {
  const dir = path.join(api.deps.cacheDir, namespace, hash.slice(0, 2), hash.slice(2, 4));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, hash), bytes);
  await writeFile(path.join(dir, `${hash}.meta.json`), '{"sha256":"x"}');
}

beforeEach(async () => {
  api = await createTestApi({ register: registerCache });
  await cacheEntry('digikey_product_details', 'a'.repeat(64), 'one');
  await cacheEntry('digikey_product_details', 'b'.repeat(64), 'two hundred bytes'.repeat(10));
  await cacheEntry('pdf_page_png', 'c'.repeat(64), 'png');
});

afterEach(async () => {
  await api.close();
});

describe('GET /api/cache', () => {
  it('counts entries and bytes per namespace', async () => {
    const result = await api.get('/api/cache');
    expect(result.status).toBe(200);
    const body = result.body as {
      namespaces: { namespace: string; entries: number; bytes: number }[];
      totals: { namespaces: number; entries: number; bytes: number };
    };
    expect(body.namespaces.map((one) => one.namespace)).toStrictEqual([
      'digikey_product_details',
      'pdf_page_png',
    ]);
    expect(body.namespaces[0]?.entries).toBe(2);
    expect(body.totals).toMatchObject({ namespaces: 2, entries: 3 });
    expect(body.totals.bytes).toBeGreaterThan(0);
  });

  it('reports an empty cache without failing', async () => {
    const empty = await createTestApi({ register: registerCache });
    const result = await empty.get('/api/cache');
    expect(result.body).toMatchObject({ namespaces: [], totals: { entries: 0, bytes: 0 } });
    await empty.close();
  });

  it('ignores a file sitting where a shard directory should be', async () => {
    await writeFile(path.join(api.deps.cacheDir, 'stray.txt'), 'not a namespace');
    await writeFile(path.join(api.deps.cacheDir, 'pdf_page_png', 'loose'), 'not a shard');
    await mkdir(path.join(api.deps.cacheDir, 'pdf_page_png', 'de'), { recursive: true });
    await writeFile(path.join(api.deps.cacheDir, 'pdf_page_png', 'de', 'loose'), 'not a shard');
    const result = await api.get('/api/cache');
    const body = result.body as { namespaces: { namespace: string }[] };
    expect(body.namespaces.map((one) => one.namespace)).not.toContain('stray.txt');
  });
});

describe('GET /api/cache/:namespace', () => {
  it('lists the entries, newest first, with a size summary', async () => {
    const result = await api.get('/api/cache/digikey_product_details');
    expect(result.status).toBe(200);
    const body = result.body as {
      namespace: string;
      total: number;
      items: { hash: string; bytes: number }[];
      sizes: { count: number };
    };
    expect(body.namespace).toBe('digikey_product_details');
    expect(body.total).toBe(2);
    expect(body.sizes.count).toBe(2);
    expect(body.items[0]?.hash).toHaveLength(64);
  });

  it('pages', async () => {
    const result = await api.get('/api/cache/digikey_product_details?limit=1');
    expect((result.body as { items: unknown[] }).items).toHaveLength(1);
  });

  it('says when nothing is cached under that name', async () => {
    const result = await api.get('/api/cache/nothing_here');
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: { code: 'WEB_CACHE_NAMESPACE_NOT_FOUND' } });
  });
});

describe('reading the directories directly', () => {
  it('finds nothing under a namespace that is not there', async () => {
    expect(await entriesOf(api.deps.cacheDir, 'never_used')).toStrictEqual([]);
  });

  it('finds no namespaces under a root that is not there', async () => {
    expect(await namespacesOf(path.join(api.root, 'nowhere'))).toStrictEqual([]);
  });
});

describe('payload shape', () => {
  it('keeps the shape of a namespace summary', async () => {
    const body = (await api.get('/api/cache')).body as {
      namespaces: Record<string, unknown>[];
    };
    const [first] = body.namespaces;
    expect(Object.keys(first ?? {}).sort()).toMatchSnapshot();
  });
});
