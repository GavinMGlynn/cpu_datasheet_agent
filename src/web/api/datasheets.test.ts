import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SHA, datasheet as datasheetFixture } from '../../../test/helpers/core-fixtures.js';
import { createTestApi, type TestApi } from '../../../test/helpers/web-api.js';
import { registerDatasheets } from './datasheets.js';

let api: TestApi;
let sha256: string;

beforeEach(async () => {
  api = await createTestApi({ register: registerDatasheets });
  const pdf = await api.addDatasheet();
  sha256 = pdf.sha256;
  api.repositories.datasheets.record(
    datasheetFixture({
      sha256,
      url: pdf.url,
      pageCount: pdf.pageCount,
      localPath: pdf.localPath,
      coversMpns: ['XYZ54331D', 'XYZ54331DR'],
    }),
  );
});

afterEach(async () => {
  await api.close();
});

describe('GET /api/datasheets', () => {
  it('lists what is stored, with the parts each one covers', async () => {
    const result = await api.get('/api/datasheets');
    expect(result.status).toBe(200);
    const body = result.body as { datasheets: { sha256: string; parts: string[] }[] };
    expect(body.datasheets).toHaveLength(1);
    expect(body.datasheets[0]?.parts).toStrictEqual(['XYZ54331D', 'XYZ54331DR']);
  });

  it('returns one by digest', async () => {
    const result = await api.get(`/api/datasheets/${sha256}`);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ datasheet: { sha256, pageCount: 4 } });
  });

  it('refuses a digest that is not one, and 404s one it does not hold', async () => {
    expect((await api.get('/api/datasheets/not-a-digest')).status).toBe(400);
    const missing = await api.get(`/api/datasheets/${SHA}`);
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ error: { code: 'WEB_DATASHEET_NOT_FOUND' } });
  });
});

describe('page text', () => {
  it('reads a page through the same toolkit the agent reads with', async () => {
    const result = await api.get(`/api/datasheets/${sha256}/pages/2`);
    expect(result.status).toBe(200);
    const body = result.body as { page: { page: number; text: string; hit: boolean } };
    expect(body.page.page).toBe(2);
    expect(body.page.text).toContain('Ordering Information');
  });

  it('serves the second read from the cache', async () => {
    await api.get(`/api/datasheets/${sha256}/pages/2`);
    const second = await api.get(`/api/datasheets/${sha256}/pages/2`);
    expect((second.body as { page: { hit: boolean } }).page.hit).toBe(true);
  });

  it('refuses a page number that is not one, or is past the end', async () => {
    expect((await api.get(`/api/datasheets/${sha256}/pages/0`)).status).toBe(400);
    expect((await api.get(`/api/datasheets/${sha256}/pages/two`)).status).toBe(400);
    const past = await api.get(`/api/datasheets/${sha256}/pages/99`);
    expect(past.status).toBe(404);
    expect(past.body).toMatchObject({ error: { code: 'WEB_PAGE_NOT_IN_DATASHEET' } });
  });
});

describe('page images', () => {
  it('renders a page as a PNG', async () => {
    const result = await api.get(`/api/datasheets/${sha256}/pages/1/image?dpi=72`);
    expect(result.status).toBe(200);
    expect(result.headers['Content-Type']).toBe('image/png');
    expect(result.headers['Cache-Control']).toBe('public, max-age=86400');
    expect(result.headers['X-Page']).toBe('1');
    expect(result.headers['X-Dpi']).toBe('72');
  });

  it('refuses a resolution outside what poppler will do', async () => {
    expect((await api.get(`/api/datasheets/${sha256}/pages/1/image?dpi=9000`)).status).toBe(400);
  });
});

describe('search and sections', () => {
  it('finds the pages a phrase appears on', async () => {
    const result = await api.get(`/api/datasheets/${sha256}/search?q=ordering`);
    const body = result.body as { matches: { page: number; line: string }[] };
    expect(body.matches.length).toBeGreaterThan(0);
    expect(body.matches[0]?.page).toBe(2);
  });

  it('finds nothing for a phrase that is not there, and refuses a one-letter search', async () => {
    const none = await api.get(`/api/datasheets/${sha256}/search?q=zzzzz`);
    expect((none.body as { matches: unknown[] }).matches).toStrictEqual([]);
    expect((await api.get(`/api/datasheets/${sha256}/search?q=a`)).status).toBe(400);
  });

  it('locates the datasheet sections', async () => {
    const result = await api.get(`/api/datasheets/${sha256}/sections`);
    expect(result.status).toBe(200);
    const sections = (result.body as { sections: Record<string, unknown[]> }).sections;
    expect(Object.keys(sections).length).toBeGreaterThan(0);
  });
});

describe('a file that is no longer on disk', () => {
  it('says so rather than failing as an internal error', async () => {
    api.repositories.datasheets.record(
      datasheetFixture({
        sha256: SHA,
        url: 'https://example.invalid/gone.pdf',
        localPath: '/nowhere/gone.pdf',
        coversMpns: ['GONE-1'],
      }),
    );
    for (const url of [
      `/api/datasheets/${SHA}/pages/1`,
      `/api/datasheets/${SHA}/pages/1/image`,
      `/api/datasheets/${SHA}/search?q=ordering`,
      `/api/datasheets/${SHA}/sections`,
    ]) {
      const result = await api.get(url);
      expect(result.status).toBe(410);
      expect(result.body).toMatchObject({ error: { code: 'WEB_DATASHEET_FILE_MISSING' } });
    }
  });
});

describe('a machine with no poppler', () => {
  it('refuses to read or render a page, and says why', async () => {
    const without = await createTestApi({ register: registerDatasheets, poppler: false });
    const pdf = await without.addDatasheet();
    without.repositories.datasheets.record(
      datasheetFixture({
        sha256: pdf.sha256,
        url: pdf.url,
        pageCount: pdf.pageCount,
        localPath: pdf.localPath,
        coversMpns: ['XYZ54331DR'],
      }),
    );
    const result = await without.get(`/api/datasheets/${pdf.sha256}/pages/1`);
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ error: { code: 'WEB_POPPLER_MISSING' } });
    // Listing what is stored needs no poppler at all.
    expect((await without.get('/api/datasheets')).status).toBe(200);
    await without.close();
  });
});

describe('payload shapes', () => {
  it('keeps the shape of a datasheet listing', async () => {
    const result = (await api.get('/api/datasheets')).body as {
      datasheets: Record<string, unknown>[];
    };
    const [first] = result.datasheets;
    expect({ ...first, localPath: '<temp>', fetchedAt: '<fixed>' }).toMatchSnapshot();
  });

  it('keeps the shape of a page read', async () => {
    const body = (await api.get(`/api/datasheets/${sha256}/pages/1`)).body as {
      page: Record<string, unknown>;
    };
    expect(Object.keys(body.page).sort()).toMatchSnapshot();
  });
});
