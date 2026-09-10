import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadMouserFixture, partNumberFixture } from '../../../test/helpers/mouser-fixtures.js';
import { jsonBody, onPost, statusBody } from '../../../test/helpers/msw.js';
import { Cache, FileCacheStore } from '../../cache/index.js';
import type { ToolCallRecord } from '../../core/index.js';
import { ToolCallLedger, readLedger, type MalformedLine } from '../../log/index.js';
import { MOUSER_HOST, MouserClient, SEARCH_BASE } from './client.js';
import { DEFAULT_TTL_SECONDS, MouserApi, OPERATIONS } from './mouser.js';

const server = setupServer();
const PART_URL = `${MOUSER_HOST}${SEARCH_BASE}/partnumber`;
const KEYWORD_URL = `${MOUSER_HOST}${SEARCH_BASE}/keyword`;

let root: string;
let cache: Cache;
let requests: number;

function api(overrides: Partial<ConstructorParameters<typeof MouserApi>[0]> = {}): MouserApi {
  return new MouserApi({
    client: new MouserClient({ apiKey: 'key-123', minIntervalMs: 0 }),
    cache,
    fallbackCurrency: 'AUD',
    ...overrides,
  });
}

function servePart(slug = 'TPS54331DR'): void {
  server.use(
    onPost(PART_URL, () => {
      requests += 1;
      return jsonBody(partNumberFixture(slug));
    }),
  );
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterAll(() => {
  server.close();
});

beforeEach(async () => {
  server.resetHandlers();
  requests = 0;
  root = await mkdtemp(path.join(tmpdir(), 'mouser-api-'));
  cache = new Cache({ store: new FileCacheStore(path.join(root, 'cache')) });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('operations', () => {
  it('searches by part number with an exact match', async () => {
    let body: unknown;
    server.use(
      onPost(PART_URL, async (request) => {
        body = await request.json();
        return jsonBody(partNumberFixture('TPS54331DR'));
      }),
    );

    const result = await api().searchPartNumber('TPS54331DR');

    expect(body).toEqual({
      SearchByPartRequest: { mouserPartNumber: 'TPS54331DR', partSearchOptions: 'Exact' },
    });
    expect(result.value.SearchResults?.NumberOfResult).toBe(1);
    expect(result.hit).toBe(false);
  });

  it('searches by keyword with a record count', async () => {
    let body: unknown;
    server.use(
      onPost(KEYWORD_URL, async (request) => {
        body = await request.json();
        return jsonBody(loadMouserFixture('TPS54331.keyword.json'));
      }),
    );

    await api().searchKeyword('TPS54331', 5);

    expect(body).toEqual({
      SearchByKeywordRequest: { keyword: 'TPS54331', records: 5, startingRecord: 0 },
    });
  });

  it('rejects a response carrying errors even though the status is 200', async () => {
    server.use(
      onPost(PART_URL, () =>
        jsonBody({
          Errors: [
            { Code: 'Invalid', Message: 'Invalid unique identifier.', PropertyName: 'API Key' },
          ],
          SearchResults: null,
        }),
      ),
    );

    await expect(api().searchPartNumber('TPS54331DR')).rejects.toMatchObject({
      code: 'MOUSER_API_ERROR',
    });
  });

  it('surfaces a transport-level failure', async () => {
    server.use(onPost(PART_URL, () => statusBody(500)));

    await expect(
      new MouserApi({
        client: new MouserClient({ apiKey: 'k', maxAttempts: 1, minIntervalMs: 0 }),
        cache,
        fallbackCurrency: 'AUD',
      }).searchPartNumber('X'),
    ).rejects.toMatchObject({ code: 'MOUSER_REQUEST_FAILED' });
  });
});

describe('caching', () => {
  it('serves a repeat call from the cache', async () => {
    servePart();
    const client = api();
    const first = await client.searchPartNumber('TPS54331DR');

    const second = await client.searchPartNumber('TPS54331DR');

    expect(second.hit).toBe(true);
    expect(second.cacheKey).toBe(first.cacheKey);
    expect(requests).toBe(1);
  });

  it('treats a different part as a different question', async () => {
    servePart();
    await api().searchPartNumber('TPS54331DR');
    await api().searchPartNumber('MP1584EN-LF-Z');

    expect(requests).toBe(2);
  });

  it('refetches when forced, and exposes its default lifetime', async () => {
    servePart();
    await api().searchPartNumber('TPS54331DR');

    const forced = await api({ force: true }).searchPartNumber('TPS54331DR');

    expect(forced.hit).toBe(false);
    expect(requests).toBe(2);
    expect(DEFAULT_TTL_SECONDS).toBe(86_400);
  });

  it('honours a configured lifetime', async () => {
    servePart();

    await expect(api({ ttlSeconds: 60 }).searchPartNumber('TPS54331DR')).resolves.toMatchObject({
      hit: false,
    });
  });

  it('does not cache a rejected response', async () => {
    server.use(
      onPost(PART_URL, () => {
        requests += 1;
        return jsonBody({ Errors: [{ Code: 'Invalid' }], SearchResults: null });
      }),
    );
    const client = api();

    await expect(client.searchPartNumber('X')).rejects.toMatchObject({ code: 'MOUSER_API_ERROR' });
    await expect(client.searchPartNumber('X')).rejects.toMatchObject({ code: 'MOUSER_API_ERROR' });

    expect(requests).toBe(2);
  });
});

describe('the ledger', () => {
  async function records(dir: string): Promise<ToolCallRecord[]> {
    const malformed: MalformedLine[] = [];
    const out: ToolCallRecord[] = [];
    for await (const record of readLedger(dir, {}, (line) => malformed.push(line))) {
      out.push(record);
    }
    expect(malformed).toEqual([]);
    return out;
  }

  it('records the call and whether the cache answered it', async () => {
    servePart();
    const dir = path.join(root, 'ledger');
    const ledger = new ToolCallLedger({ dir, sessionId: 'run-1' });
    const client = api({ ledger });

    await client.searchPartNumber('TPS54331DR');
    await client.searchPartNumber('TPS54331DR');
    await ledger.flush();

    const written = await records(dir);
    expect(written).toHaveLength(2);
    expect(written[0]).toMatchObject({
      tool: OPERATIONS.searchPartNumber,
      input: { mpn: 'TPS54331DR' },
      spendsQuota: true,
      output: { hit: false },
    });
    expect(written[1]).toMatchObject({ output: { hit: true } });
  });

  it('records a rejected response with its code', async () => {
    server.use(
      onPost(PART_URL, () => jsonBody({ Errors: [{ Code: 'Invalid' }], SearchResults: null })),
    );
    const dir = path.join(root, 'ledger');
    const ledger = new ToolCallLedger({ dir, sessionId: 'run-2' });

    await expect(api({ ledger }).searchPartNumber('X')).rejects.toMatchObject({
      code: 'MOUSER_API_ERROR',
    });
    await ledger.flush();

    expect(await records(dir)).toMatchObject([{ error: { code: 'MOUSER_API_ERROR' } }]);
  });

  it('works without a ledger', async () => {
    servePart();

    await expect(api().searchPartNumber('TPS54331DR')).resolves.toMatchObject({ hit: false });
  });
});

describe('lookup', () => {
  it('returns the offer, siblings, and unmapped attribute names', async () => {
    servePart();

    const lookup = await api().lookup('TPS54331DR');

    expect(lookup.mpn).toBe('TPS54331DR');
    expect(lookup.manufacturer).toBe('Texas Instruments');
    expect(lookup.offer.sku).toBe('595-TPS54331DR');
    expect(lookup.offer.currency).toBe('USD');
    expect(lookup.siblings).toContain('TPS54331D');
    expect(lookup.unmapped).toEqual(['Packaging', 'Standard Pack Qty']);
    expect(lookup.datasheetUrl).toBeUndefined();
    expect(lookup.hit).toBe(false);
  });

  it('returns the datasheet link for the one recorded part that has one', async () => {
    servePart('LT8610AEMSE-PBF');

    const lookup = await api().lookup('LT8610AEMSE#PBF');

    expect(lookup.datasheetUrl).toContain('mouser.com/datasheet');
    expect(lookup.offer.packaging).toBe('tube');
  });

  it('reports a part Mouser does not list as a fact about the part', async () => {
    server.use(onPost(PART_URL, () => jsonBody(partNumberFixture('XL4015E1'))));

    await expect(api().lookup('XL4015E1')).rejects.toMatchObject({
      code: 'MOUSER_NOT_FOUND',
      details: { mpn: 'XL4015E1' },
    });
  });

  it('reports the cache hit of the underlying call', async () => {
    servePart();
    const client = api();
    await client.lookup('TPS54331DR');

    await expect(client.lookup('TPS54331DR')).resolves.toMatchObject({ hit: true });
  });

  it('carries the response cache key onto the offer as provenance', async () => {
    servePart();

    const lookup = await api().lookup('TPS54331DR');

    expect(lookup.offer.provenance.cacheKey).toMatch(/^[a-f0-9]{64}$/);
    expect(lookup.offer.provenance.distributor).toBe('mouser');
  });
});
