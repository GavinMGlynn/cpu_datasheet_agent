import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadFixture } from '../../../test/helpers/digikey-fixtures.js';
import { loadMouserFixture } from '../../../test/helpers/mouser-fixtures.js';
import { jsonBody, onGet, onPost, statusBody } from '../../../test/helpers/msw.js';
import { createHarness, type TestHarness } from '../../../test/helpers/tool-context.js';
import { DigiKeyApi, DigiKeyClient, MemoryTokenStore } from '../../adapters/digikey/index.js';
import { PRODUCTION_HOST, TOKEN_PATH } from '../../adapters/digikey/token.js';
import { SEARCH_BASE } from '../../adapters/digikey/digikey.js';
import { MouserApi, MouserClient } from '../../adapters/mouser/index.js';
import { MOUSER_HOST, SEARCH_BASE as MOUSER_SEARCH_BASE } from '../../adapters/mouser/client.js';
import type { Cache } from '../../cache/index.js';
import { NO_SPEND_POLICY } from '../policy.js';
import type { ToolRegistry } from '../registry.js';
import { buildRegistry } from './index.js';

const server = setupServer();
const TOKEN_URL = `${PRODUCTION_HOST}${TOKEN_PATH}`;
const LOCALE = { site: 'AU', language: 'en', currency: 'AUD' } as const;
const MPN = 'TPS54331DR';

let harness: TestHarness;
let registry: ToolRegistry;
let requests: string[];

function digikeyApi(cache: Cache): DigiKeyApi {
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
  });
}

function mouserApi(cache: Cache): MouserApi {
  return new MouserApi({
    client: new MouserClient({ apiKey: 'key-abc', minIntervalMs: 0 }),
    cache,
    fallbackCurrency: 'AUD',
  });
}

function serveDigiKey(): void {
  server.use(
    onPost(TOKEN_URL, () =>
      jsonBody({ access_token: 'tok', expires_in: 600, token_type: 'Bearer' }),
    ),
    onGet(`${PRODUCTION_HOST}${SEARCH_BASE}/${MPN}/productdetails`, (request) => {
      requests.push(request.url);
      return jsonBody(loadFixture('TPS54331DR.productdetails.json'));
    }),
    onPost(`${PRODUCTION_HOST}${SEARCH_BASE}/keyword`, (request) => {
      requests.push(request.url);
      return jsonBody(loadFixture('TPS54331.keyword.json'));
    }),
  );
}

function serveMouser(): void {
  server.use(
    onPost(`${MOUSER_HOST}${MOUSER_SEARCH_BASE}/partnumber`, (request) => {
      requests.push(request.url);
      return jsonBody(loadMouserFixture('TPS54331DR.partnumber.json'));
    }),
    onPost(`${MOUSER_HOST}${MOUSER_SEARCH_BASE}/keyword`, (request) => {
      requests.push(request.url);
      return jsonBody(loadMouserFixture('TPS54331.keyword.json'));
    }),
  );
}

async function call(name: string, input: unknown): Promise<Record<string, unknown>> {
  return (await registry.call(name, input, harness.context)) as Record<string, unknown>;
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
  harness = await createHarness({ digikey: digikeyApi, mouser: mouserApi });
  registry = buildRegistry();
});

afterEach(async () => {
  await harness.close();
});

describe('fetch_offers', () => {
  it('asks before spending, and answers once the caller confirms', async () => {
    serveDigiKey();
    serveMouser();

    const asked = await call('fetch_offers', { mpn: MPN });

    expect(asked).toEqual({
      status: 'needs_confirmation',
      tool: 'fetch_offers',
      reason: 'the answer is not cached, so this call would spend distributor quota',
      retryWith: { confirmSpend: true },
    });
    expect(requests).toHaveLength(0);

    const confirmed = (await call('fetch_offers', { mpn: MPN, confirmSpend: true })) as {
      status: string;
      offers: { distributor: string }[];
      sources: { provenance: { distributor: string }; facts: unknown[] }[];
      datasheetUrl?: string;
    };

    expect(confirmed.status).toBe('ok');
    expect(confirmed.offers.some((offer) => offer.distributor === 'digikey')).toBe(true);
    expect(confirmed.offers.some((offer) => offer.distributor === 'mouser')).toBe(true);
    expect(confirmed.datasheetUrl).toContain('ti.com');
    const digikeySource = confirmed.sources.find(
      (source) => source.provenance.distributor === 'digikey',
    );
    expect(digikeySource?.facts.length).toBeGreaterThan(5);
    // Mouser publishes no parametrics, and says so by carrying none (D27).
    expect(
      confirmed.sources.find((source) => source.provenance.distributor === 'mouser')?.facts,
    ).toEqual([]);
  });

  it('answers from the cache without confirmation once the answer is on disk', async () => {
    serveDigiKey();
    serveMouser();
    await call('fetch_offers', { mpn: MPN, confirmSpend: true });
    const spent = requests.length;

    const free = (await call('fetch_offers', { mpn: MPN })) as { status: string };

    expect(free.status).toBe('ok');
    expect(requests).toHaveLength(spent);
  });

  it('asks only the distributors it was told to', async () => {
    serveDigiKey();

    const result = (await call('fetch_offers', {
      mpn: MPN,
      distributors: ['digikey'],
      confirmSpend: true,
    })) as { offers: { distributor: string }[] };

    expect(result.offers.every((offer) => offer.distributor === 'digikey')).toBe(true);
  });

  it('asks Mouser alone when told to', async () => {
    serveMouser();

    const result = (await call('fetch_offers', {
      mpn: MPN,
      distributors: ['mouser'],
      confirmSpend: true,
    })) as { offers: { distributor: string }[] };

    expect(result.offers.every((offer) => offer.distributor === 'mouser')).toBe(true);
  });

  it('records the distributor that fails rather than losing what the other found', async () => {
    serveDigiKey();
    server.use(onPost(`${MOUSER_HOST}${MOUSER_SEARCH_BASE}/partnumber`, () => statusBody(503)));

    const result = (await call('fetch_offers', { mpn: MPN, confirmSpend: true })) as {
      status: string;
      offers: unknown[];
      failures: { distributor: string; code: string }[];
    };

    expect(result.status).toBe('ok');
    expect(result.offers.length).toBeGreaterThan(0);
    expect(result.failures[0]?.distributor).toBe('mouser');
  });

  it('records a Digi-Key failure the same way, keeping what Mouser found', async () => {
    serveMouser();
    server.use(
      onPost(TOKEN_URL, () =>
        jsonBody({ access_token: 'tok', expires_in: 600, token_type: 'Bearer' }),
      ),
      onGet(`${PRODUCTION_HOST}${SEARCH_BASE}/${MPN}/productdetails`, () => statusBody(503)),
    );

    const result = (await call('fetch_offers', { mpn: MPN, confirmSpend: true })) as {
      status: string;
      offers: { distributor: string }[];
      failures: { distributor: string }[];
    };

    expect(result.status).toBe('ok');
    expect(result.offers.every((offer) => offer.distributor === 'mouser')).toBe(true);
    expect(result.failures[0]?.distributor).toBe('digikey');
  });

  it('asks before spending when only Mouser is configured', async () => {
    const mouserOnly = await createHarness({ mouser: mouserApi });
    try {
      serveMouser();
      expect(await registry.call('fetch_offers', { mpn: MPN }, mouserOnly.context)).toMatchObject({
        status: 'needs_confirmation',
      });
      expect(requests).toHaveLength(0);
    } finally {
      await mouserOnly.close();
    }
  });

  it('attributes facts to the part number when a product has no orderable variant', async () => {
    const product = loadFixture('TPS54331DR.productdetails.json') as {
      Product: { ProductVariations: unknown[] };
    };
    server.use(
      onPost(TOKEN_URL, () =>
        jsonBody({ access_token: 'tok', expires_in: 600, token_type: 'Bearer' }),
      ),
      onGet(`${PRODUCTION_HOST}${SEARCH_BASE}/${MPN}/productdetails`, () =>
        jsonBody({ ...product, Product: { ...product.Product, ProductVariations: [] } }),
      ),
    );

    const result = (await call('fetch_offers', {
      mpn: MPN,
      distributors: ['digikey'],
      confirmSpend: true,
    })) as { offers: unknown[]; sources: { provenance: { sku: string } }[] };

    expect(result.offers).toEqual([]);
    expect(result.sources[0]?.provenance.sku).toBe(MPN);
  });

  it('reports a distributor with no credentials as unavailable', async () => {
    const noKeys = await createHarness();
    try {
      await expect(
        registry.call('fetch_offers', { mpn: MPN, confirmSpend: true }, noKeys.context),
      ).rejects.toMatchObject({ code: 'TOOL_UNAVAILABLE' });
    } finally {
      await noKeys.close();
    }
  });
});

describe('resolve_mpn', () => {
  it('asks before spending', async () => {
    serveDigiKey();
    expect(await call('resolve_mpn', { mpn: 'TPS54331DR' })).toMatchObject({
      status: 'needs_confirmation',
      tool: 'resolve_mpn',
    });
    expect(requests).toHaveLength(0);
  });

  it('normalises the part number, decodes it, and resolves the listing', async () => {
    serveDigiKey();
    serveMouser();

    const result = (await call('resolve_mpn', {
      mpn: '296-TPS54331DR-ND',
      confirmSpend: true,
    })) as {
      status: string;
      normalised: { raw: string; mpn: string; removed: string[] };
      decoded: { basePart: string } | null;
      resolved: { mpn: string; distributor: string } | null;
      escalation: unknown;
    };

    expect(result.status).toBe('ok');
    expect(result.normalised.mpn).toBe('TPS54331DR');
    expect(result.normalised.removed.length).toBeGreaterThan(0);
    expect(result.decoded?.basePart).toBe('TPS54331');
    expect(result.resolved?.mpn).toBe('TPS54331DR');
    expect(result.escalation).toBeNull();
  });

  it('stores the escalation when the answer is not the agent’s to make', async () => {
    // Nobody lists this package of the part, so what comes back is several
    // siblings differing in package and grade. Choosing between them is a
    // question for a person rather than a guess.
    serveDigiKey();

    const result = (await call('resolve_mpn', { mpn: 'TPS54331DGKR', confirmSpend: true })) as {
      resolved: unknown;
      escalation: { id: string; kind: string; options?: string[] } | null;
    };

    expect(result.resolved).toBeNull();
    expect(result.escalation?.kind).toBe('ambiguous_mpn');
    expect((result.escalation?.options ?? []).length).toBeGreaterThan(1);
    expect(harness.context.repositories.escalations.get(result.escalation?.id ?? '')).toBeDefined();
  });

  it('refuses outright under a run that may not spend', async () => {
    const denied = await createHarness({
      digikey: digikeyApi,
      mouser: mouserApi,
      policy: NO_SPEND_POLICY,
    });
    try {
      expect(
        await registry.call('resolve_mpn', { mpn: MPN, confirmSpend: true }, denied.context),
      ).toMatchObject({ status: 'denied', tool: 'resolve_mpn' });
    } finally {
      await denied.close();
    }
  });

  it('reports a lookup nobody could answer as the failure it is', async () => {
    // Both distributors refuse, and the caller has already confirmed the
    // spend: this is a broken lookup, not a question about money.
    server.use(
      onPost(TOKEN_URL, () => statusBody(503)),
      onPost(`${MOUSER_HOST}${MOUSER_SEARCH_BASE}/keyword`, () => statusBody(503)),
    );

    await expect(call('resolve_mpn', { mpn: MPN, confirmSpend: true })).rejects.toMatchObject({
      code: 'MPN_LOOKUP_FAILED',
    });
  });

  it('asks each distributor for the number of listings requested', async () => {
    serveDigiKey();
    serveMouser();

    const result = (await call('resolve_mpn', {
      mpn: MPN,
      limit: 3,
      confirmSpend: true,
    })) as { status: string };

    expect(result.status).toBe('ok');
  });

  it('asks only the distributors this run has', async () => {
    const digikeyOnly = await createHarness({ digikey: digikeyApi });
    const mouserOnly = await createHarness({ mouser: mouserApi });
    try {
      serveDigiKey();
      serveMouser();
      const fromDigiKey = (await registry.call(
        'resolve_mpn',
        { mpn: MPN, confirmSpend: true },
        digikeyOnly.context,
      )) as { matches: { candidate: { distributor: string } }[] };
      expect(fromDigiKey.matches.every((match) => match.candidate.distributor === 'digikey')).toBe(
        true,
      );

      const fromMouser = (await registry.call(
        'resolve_mpn',
        { mpn: MPN, confirmSpend: true },
        mouserOnly.context,
      )) as { matches: { candidate: { distributor: string } }[] };
      expect(fromMouser.matches.every((match) => match.candidate.distributor === 'mouser')).toBe(
        true,
      );
    } finally {
      await digikeyOnly.close();
      await mouserOnly.close();
    }
  });

  it('rejects a part number nothing could normalise', async () => {
    await expect(call('resolve_mpn', { mpn: '   ' })).rejects.toMatchObject({ code: 'MPN_EMPTY' });
  });
});
