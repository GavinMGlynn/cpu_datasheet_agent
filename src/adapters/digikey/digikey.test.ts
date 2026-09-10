import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadFixture } from '../../../test/helpers/digikey-fixtures.js';
import { jsonBody, onGet, onPost, statusBody } from '../../../test/helpers/msw.js';
import { Cache, FileCacheStore } from '../../cache/index.js';
import type { ToolCallRecord } from '../../core/index.js';
import { ToolCallLedger, readLedger, type MalformedLine } from '../../log/index.js';
import { DigiKeyClient } from './client.js';
import { DEFAULT_TTL_SECONDS, DigiKeyApi, OPERATIONS, SEARCH_BASE } from './digikey.js';
import { MemoryTokenStore, PRODUCTION_HOST, TOKEN_PATH } from './token.js';

const server = setupServer();
const TOKEN_URL = `${PRODUCTION_HOST}${TOKEN_PATH}`;
const MPN = 'TPS54331DR';
const LOCALE = { site: 'AU', language: 'en', currency: 'AUD' };

let root: string;
let cache: Cache;
let requests: string[];

function endpoint(mpn: string, operation: string): string {
  return `${PRODUCTION_HOST}${SEARCH_BASE}/${encodeURIComponent(mpn)}/${operation}`;
}

function serve(mpn: string, operation: string, fixture: string): void {
  server.use(
    onGet(endpoint(mpn, operation), (request) => {
      requests.push(request.url);
      return jsonBody(loadFixture(fixture));
    }),
  );
}

function api(overrides: Partial<ConstructorParameters<typeof DigiKeyApi>[0]> = {}): DigiKeyApi {
  return new DigiKeyApi({
    client: new DigiKeyClient({
      clientId: 'id-abc',
      clientSecret: 'secret-xyz',
      locale: LOCALE,
      tokenStore: new MemoryTokenStore(),
      minIntervalMs: 0,
    }),
    cache,
    locale: LOCALE,
    ...overrides,
  });
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterAll(() => {
  server.close();
});

beforeEach(async () => {
  server.resetHandlers();
  requests = [];
  root = await mkdtemp(path.join(tmpdir(), 'dk-api-'));
  cache = new Cache({ store: new FileCacheStore(path.join(root, 'cache')) });
  server.use(
    onPost(TOKEN_URL, () =>
      jsonBody({ access_token: 'tok', expires_in: 600, token_type: 'Bearer' }),
    ),
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('operations', () => {
  it.each([
    ['productDetails', 'productdetails', 'TPS54331DR.productdetails.json'],
    ['pricing', 'pricing', 'TPS54331DR.pricing.json'],
    ['media', 'media', 'TPS54331DR.media.json'],
    ['substitutions', 'substitutions', 'TPS54331DR.substitutions.json'],
    ['alternatePackaging', 'alternatepackaging', 'TPS54331DR.alternatepackaging.json'],
  ] as const)(
    '%s calls the right endpoint and validates the response',
    async (method, endpointName, fixture) => {
      serve(MPN, endpointName, fixture);

      const result = await api()[method](MPN);

      expect(result.hit).toBe(false);
      expect(result.cacheKey).toMatch(/^[a-f0-9]{64}$/);
      expect(requests).toEqual([endpoint(MPN, endpointName)]);
    },
  );

  it('searches by keyword with the documented body', async () => {
    let body: unknown;
    server.use(
      onPost(`${PRODUCTION_HOST}${SEARCH_BASE}/keyword`, async (request) => {
        body = await request.json();
        return jsonBody(loadFixture('TPS54331.keyword.json'));
      }),
    );

    const result = await api().searchKeyword('TPS54331', 5);

    expect(body).toEqual({ Keywords: 'TPS54331', Limit: 5, Offset: 0 });
    expect(result.value.Products.length).toBeGreaterThan(0);
  });

  it('escapes a part number that contains path characters', async () => {
    const awkward = 'LT8610AEMSE#PBF';
    serve(awkward, 'productdetails', 'LT8610AEMSE-PBF.productdetails.json');

    await api().productDetails(awkward);

    expect(requests[0]).toContain('LT8610AEMSE%23PBF');
  });

  it('reports a part Digi-Key does not list', async () => {
    server.use(onGet(endpoint('XL4015E1', 'productdetails'), () => statusBody(404)));

    await expect(api().productDetails('XL4015E1')).rejects.toMatchObject({
      code: 'DIGIKEY_NOT_FOUND',
    });
  });
});

describe('caching', () => {
  it('serves a repeat call from the cache, spending no quota', async () => {
    serve(MPN, 'productdetails', 'TPS54331DR.productdetails.json');
    const client = api();
    const first = await client.productDetails(MPN);
    server.resetHandlers();
    server.use(
      onPost(TOKEN_URL, () =>
        jsonBody({ access_token: 'tok', expires_in: 600, token_type: 'Bearer' }),
      ),
    );

    const second = await client.productDetails(MPN);

    expect(second.hit).toBe(true);
    expect(second.cacheKey).toBe(first.cacheKey);
    expect(second.value).toEqual(first.value);
    expect(requests).toHaveLength(1);
  });

  it('treats a different locale as a different question', async () => {
    serve(MPN, 'productdetails', 'TPS54331DR.productdetails.json');
    await api().productDetails(MPN);

    await api({ locale: { site: 'US', language: 'en', currency: 'USD' } }).productDetails(MPN);

    expect(requests).toHaveLength(2);
  });

  it('treats the sandbox as a different question', async () => {
    serve(MPN, 'productdetails', 'TPS54331DR.productdetails.json');
    await api().productDetails(MPN);

    await api({ sandbox: true }).productDetails(MPN);

    expect(requests).toHaveLength(2);
  });

  it('refetches when forced', async () => {
    serve(MPN, 'productdetails', 'TPS54331DR.productdetails.json');
    await api().productDetails(MPN);

    const forced = await api({ force: true }).productDetails(MPN);

    expect(forced.hit).toBe(false);
    expect(requests).toHaveLength(2);
  });

  it('applies a per-operation lifetime, defaulting by how fast the data moves', async () => {
    expect(DEFAULT_TTL_SECONDS.pricing).toBe(86_400);
    expect(DEFAULT_TTL_SECONDS.media).toBe(604_800);

    serve(MPN, 'media', 'TPS54331DR.media.json');
    const result = await api({ ttlSeconds: { media: 60 } }).media(MPN);

    expect(result.value.MediaLinks.length).toBeGreaterThan(0);
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

  it('records the call, its parameters, and whether the cache answered it', async () => {
    serve(MPN, 'productdetails', 'TPS54331DR.productdetails.json');
    const dir = path.join(root, 'ledger');
    const ledger = new ToolCallLedger({ dir, sessionId: 'run-1' });
    const client = api({ ledger });

    await client.productDetails(MPN);
    await client.productDetails(MPN);
    await ledger.flush();

    const written = await records(dir);
    expect(written).toHaveLength(2);
    expect(written[0]).toMatchObject({
      tool: OPERATIONS.productDetails,
      sessionId: 'run-1',
      input: { mpn: MPN },
      spendsQuota: true,
      output: { hit: false },
    });
    expect(written[1]).toMatchObject({ output: { hit: true } });
  });

  it('records a failure with its error code', async () => {
    server.use(onGet(endpoint('XL4015E1', 'productdetails'), () => statusBody(404)));
    const dir = path.join(root, 'ledger');
    const ledger = new ToolCallLedger({ dir, sessionId: 'run-2' });

    await expect(api({ ledger }).productDetails('XL4015E1')).rejects.toMatchObject({
      code: 'DIGIKEY_NOT_FOUND',
    });
    await ledger.flush();

    expect(await records(dir)).toMatchObject([{ error: { code: 'DIGIKEY_NOT_FOUND' } }]);
  });

  it('works without a ledger', async () => {
    serve(MPN, 'productdetails', 'TPS54331DR.productdetails.json');

    await expect(api().productDetails(MPN)).resolves.toMatchObject({ hit: false });
  });
});

describe('lookup', () => {
  it('composes offers, parametric facts, and the datasheet URL from one call', async () => {
    serve(MPN, 'productdetails', 'TPS54331DR.productdetails.json');

    const lookup = await api().lookup(MPN);

    expect(lookup.mpn).toBe(MPN);
    expect(lookup.manufacturer).toBe('Texas Instruments');
    expect(lookup.offers).toHaveLength(3);
    expect(lookup.datasheetUrl).toContain('ti.com');
    expect(lookup.baseProductNumber).toBe('TPS54331');
    expect(lookup.failures).toEqual([]);
    expect(lookup.facts.map((fact) => fact.key)).toEqual(
      expect.arrayContaining(['vinMin', 'vinMax', 'ioutMax']),
    );
    expect(lookup.unmapped).toContain('Topology');
    expect(requests).toHaveLength(1);
  });

  it('carries the response cache key onto every offer as provenance', async () => {
    serve(MPN, 'productdetails', 'TPS54331DR.productdetails.json');

    const lookup = await api().lookup(MPN);

    for (const offer of lookup.offers) {
      expect(offer.provenance.cacheKey).toMatch(/^[a-f0-9]{64}$/);
      expect(offer.provenance.distributor).toBe('digikey');
    }
  });

  it('falls back to the media endpoint only when the product carries no datasheet URL', async () => {
    const details = loadFixture('TPS54331DR.productdetails.json') as {
      Product: Record<string, unknown>;
    };
    const { DatasheetUrl: _url, ...productWithoutUrl } = details.Product;
    server.use(
      onGet(endpoint(MPN, 'productdetails'), (request) => {
        requests.push(request.url);
        return jsonBody({ ...details, Product: productWithoutUrl });
      }),
    );
    serve(MPN, 'media', 'TPS54331DR.media.json');

    const lookup = await api().lookup(MPN);

    expect(lookup.datasheetUrl).toContain('ti.com');
    expect(requests).toHaveLength(2);
  });

  it('reports the cache hit of the underlying call', async () => {
    serve(MPN, 'productdetails', 'TPS54331DR.productdetails.json');
    const client = api();
    await client.lookup(MPN);

    await expect(client.lookup(MPN)).resolves.toMatchObject({ hit: true });
  });

  it('works for a synchronous part with a different manufacturer', async () => {
    serve('AP63203WU-7', 'productdetails', 'AP63203WU-7.productdetails.json');

    const lookup = await api().lookup('AP63203WU-7');

    expect(lookup.manufacturer).toContain('Diodes');
    expect(lookup.offers.length).toBeGreaterThan(0);
    expect(
      lookup.facts.some((fact) => fact.key === 'topology' && fact.value === 'synchronous'),
    ).toBe(true);
  });
});
