import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buckParameters,
  conflict,
  offer,
  param,
  part as partFixture,
  q,
  verification,
  withConfidence,
  type Loose,
} from '../../../test/helpers/core-fixtures.js';
import { createTestApi, type TestApi } from '../../../test/helpers/web-api.js';
import { parameterRows, registerParts } from './parts.js';
import { Part } from '../../core/part.js';
import { parseOrThrow } from '../../core/validation-error.js';

let api: TestApi;

function seed(overrides: Loose = {}): void {
  api.repositories.parts.upsertPart(partFixture(overrides));
}

beforeEach(async () => {
  api = await createTestApi({ register: registerParts });
  seed();
  seed({
    mpn: 'AP62200WU-7',
    manufacturer: 'Diodes Incorporated',
    status: 'verified',
    parameters: withConfidence(buckParameters({ vinMax: param(q(18, 'V'), 4) }), 'verified'),
    offers: [offer({ stock: 500, priceBreaks: [{ quantity: 1, unitPrice: 0.92 }] })],
    verifications: [verification()],
  });
  seed({
    mpn: 'LM5164QDDARQ1',
    manufacturer: 'Texas Instruments',
    status: 'needs_human',
    parameters: buckParameters({
      // A synchronous part is the only kind with a low-side FET to state an
      // on-resistance for, and the schema enforces that.
      topology: param('synchronous', 1),
      rdsOnLow: { ...param(q(0.34, 'Ohm')), confidence: 'conflict', conflicts: [conflict()] },
    }),
    offers: [],
  });
});

afterEach(async () => {
  await api.close();
});

describe('GET /api/parts', () => {
  it('lists every stored part with its summary', async () => {
    const result = await api.get('/api/parts');
    expect(result.status).toBe(200);
    const body = result.body as { total: number; items: { mpn: string }[]; source: string };
    expect(body.total).toBe(3);
    expect(body.source).toBe('live');
    expect(body.items.map((item) => item.mpn)).toStrictEqual([
      'AP62200WU-7',
      'LM5164QDDARQ1',
      'TPS54331DR',
    ]);
  });

  it('filters by status, manufacturer, category and free text', async () => {
    const byStatus = await api.get('/api/parts?status=verified');
    expect((byStatus.body as { total: number }).total).toBe(1);
    const byManufacturer = await api.get('/api/parts?manufacturer=Texas%20Instruments');
    expect((byManufacturer.body as { total: number }).total).toBe(2);
    const byCategory = await api.get('/api/parts?category=buck_regulator');
    expect((byCategory.body as { total: number }).total).toBe(3);
    const byText = await api.get('/api/parts?text=ap62');
    expect((byText.body as { total: number }).total).toBe(1);
    const byMaker = await api.get('/api/parts?text=diodes');
    expect((byMaker.body as { total: number }).total).toBe(1);
  });

  it('sorts by every field it offers, both ways', async () => {
    const order = async (url: string): Promise<string[]> => {
      const result = await api.get(url);
      return (result.body as { items: { mpn: string }[] }).items.map((item) => item.mpn);
    };
    expect(await order('/api/parts?sort=mpn&direction=desc')).toStrictEqual([
      'TPS54331DR',
      'LM5164QDDARQ1',
      'AP62200WU-7',
    ]);
    expect((await order('/api/parts?sort=price'))[0]).toBe('AP62200WU-7');
    expect((await order('/api/parts?sort=stock&direction=desc'))[0]).toBe('TPS54331DR');
    expect((await order('/api/parts?sort=verified&direction=desc'))[0]).toBe('AP62200WU-7');
    expect(await order('/api/parts?sort=manufacturer')).toHaveLength(3);
    expect(await order('/api/parts?sort=status')).toHaveLength(3);
    expect(await order('/api/parts?sort=updatedAt')).toHaveLength(3);
    expect(await order('/api/parts?sort=stated')).toHaveLength(3);
  });

  it('pages through the list, reporting the total behind the page', async () => {
    const result = await api.get('/api/parts?limit=2&offset=2');
    expect(result.body).toMatchObject({ total: 3, offset: 2, limit: 2 });
    expect((result.body as { items: unknown[] }).items).toHaveLength(1);
  });

  it('prices at the quantity and currency asked for', async () => {
    const result = await api.get('/api/parts?quantity=100&currency=AUD&sort=price');
    const items = (
      result.body as { items: { mpn: string; bestPrice: { amount: number } | null }[] }
    ).items;
    expect(items[0]?.bestPrice?.amount).toBe(0.92);
    const usd = await api.get('/api/parts?currency=USD');
    expect(
      (usd.body as { items: { bestPrice: unknown }[] }).items.every(
        (item) => item.bestPrice === null,
      ),
    ).toBe(true);
  });

  it('refuses a query it cannot read rather than guessing', async () => {
    const badLimit = await api.get('/api/parts?limit=abc');
    expect(badLimit.status).toBe(400);
    expect(badLimit.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect((await api.get('/api/parts?status=nonsense')).status).toBe(400);
    expect((await api.get('/api/parts?sort=cheapest')).status).toBe(400);
    expect((await api.get('/api/parts?unknown=1')).status).toBe(400);
  });

  it('says which database it cannot find', async () => {
    const result = await api.get('/api/parts?source=nowhere');
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: { code: 'WEB_SOURCE_NOT_FOUND' } });
  });
});

describe('GET /api/parts/:mpn', () => {
  it('returns the stored aggregate with everything that hangs off it', async () => {
    const result = await api.get('/api/parts/TPS54331DR');
    expect(result.status).toBe(200);
    const body = result.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toStrictEqual([
      'datasheetMpns',
      'escalations',
      'parameters',
      'part',
      'runs',
      'source',
      'summary',
      'verdicts',
    ]);
    expect((body.parameters as unknown[]).length).toBe(30);
  });

  it('decodes an MPN with a slash in it', async () => {
    seed({ mpn: 'LM2596S-3.3/NOPB' });
    const result = await api.get('/api/parts/LM2596S-3.3%2FNOPB');
    expect(result.status).toBe(200);
    expect((result.body as { part: { mpn: string } }).part.mpn).toBe('LM2596S-3.3/NOPB');
  });

  it('says plainly when a part is not in this database', async () => {
    const result = await api.get('/api/parts/NOTHING-1');
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({
      error: { code: 'WEB_PART_NOT_FOUND', details: { source: 'live' } },
    });
  });

  it('has no family to list for a part with no datasheet', async () => {
    const byHand: Loose = {};
    for (const [key, value] of Object.entries(buckParameters())) {
      byHand[key] = {
        ...(value as Loose),
        provenance: {
          source: 'human',
          note: 'from the ordering guide',
          recordedAt: '2026-09-10T00:00:00Z',
        },
      };
    }
    seed({ mpn: 'MCP16331T-E/CH', datasheet: undefined, parameters: byHand });
    const result = await api.get('/api/parts/MCP16331T-E%2FCH');
    expect(result.status).toBe(200);
    expect((result.body as { datasheetMpns: string[] }).datasheetMpns).toStrictEqual([]);
  });

  it('lists the other part numbers the same datasheet covers', async () => {
    const result = await api.get('/api/parts/TPS54331DR');
    expect((result.body as { datasheetMpns: string[] }).datasheetMpns).toStrictEqual([
      'TPS54331D',
      'TPS54331DR',
    ]);
  });
});

describe('the endpoints that hang off a part', () => {
  it('returns a row per schema key, verdict included', async () => {
    const result = await api.get('/api/parts/AP62200WU-7/parameters');
    const rows = (result.body as { parameters: { key: string; verdict?: unknown }[] }).parameters;
    expect(rows).toHaveLength(30);
    expect(rows.find((row) => row.key === 'vinMax')?.verdict).toMatchObject({
      verdict: 'confirmed',
    });
  });

  it('prices each offer at the quantity asked for', async () => {
    const result = await api.get('/api/parts/TPS54331DR/offers?quantity=100');
    const offers = (result.body as { offers: { unitPrice: { amount: number } }[] }).offers;
    expect(offers[0]?.unitPrice.amount).toBe(1.42);
  });

  it('reports no price where the quantity is below every break', async () => {
    seed({
      mpn: 'TPS62130RGTR',
      offers: [offer({ priceBreaks: [{ quantity: 3000, unitPrice: 0.5 }] })],
    });
    const result = await api.get('/api/parts/TPS62130RGTR/offers?quantity=1');
    expect((result.body as { offers: { unitPrice: unknown }[] }).offers[0]?.unitPrice).toBeNull();
  });

  it('returns the runs and the verifications for a part', async () => {
    const runs = await api.get('/api/parts/TPS54331DR/runs');
    expect(runs.body).toStrictEqual({ runs: [] });
    const verifications = await api.get('/api/parts/AP62200WU-7/verifications');
    expect(verifications.body).toMatchObject({
      counts: { confirmed: 1, unchecked: 29 },
    });
    expect((verifications.body as { verifications: unknown[] }).verifications).toHaveLength(1);
  });

  it('404s every one of them for a part that is not there', async () => {
    for (const suffix of ['parameters', 'offers', 'runs', 'verifications']) {
      expect((await api.get(`/api/parts/NOTHING-1/${suffix}`)).status).toBe(404);
    }
  });
});

describe('the catalogue endpoints', () => {
  it('adds up the whole store', async () => {
    const result = await api.get('/api/catalog/totals');
    expect(result.body).toMatchObject({
      source: 'live',
      totals: { parts: 3, offers: 2, datasheets: 1 },
    });
  });

  it('reports coverage per parameter across the set', async () => {
    const result = await api.get('/api/catalog/coverage');
    const coverage = (result.body as { coverage: { key: string; stated: number }[] }).coverage;
    expect(coverage).toHaveLength(30);
    expect(coverage.find((cell) => cell.key === 'vinMax')).toMatchObject({ stated: 3, parts: 3 });
  });

  it('distributes one parameter over the set', async () => {
    const result = await api.get('/api/catalog/distribution/vinMax?buckets=2');
    expect(result.body).toMatchObject({ key: 'vinMax', unit: 'V', nonNumeric: 0 });
    expect((result.body as { buckets: unknown[] }).buckets).toHaveLength(2);
  });

  it('refuses a parameter key that is not in the schema', async () => {
    expect((await api.get('/api/catalog/distribution/nonsense')).status).toBe(400);
  });

  it('compares the parts it is given, side by side', async () => {
    const result = await api.get('/api/catalog/compare?mpns=TPS54331DR,AP62200WU-7');
    const body = result.body as { parts: unknown[]; keys: unknown[]; axes: unknown[] };
    expect(body.parts).toHaveLength(2);
    expect(body.keys).toHaveLength(30);
    expect(body.axes.length).toBeGreaterThan(0);
  });

  it('refuses a comparison of nothing, and 404s one naming a part it lacks', async () => {
    expect((await api.get('/api/catalog/compare?mpns=')).status).toBe(400);
    expect((await api.get('/api/catalog/compare?mpns=TPS54331DR,NOTHING-1')).status).toBe(404);
  });
});

describe('parameterRows', () => {
  it('keeps the latest verdict even when the older one is stored last', () => {
    const part = parseOrThrow(
      Part,
      partFixture({
        verifications: [
          verification({ parameterKey: 'vinMax', checkedAt: '2026-09-12T00:00:00Z' }),
          verification({
            parameterKey: 'vinMax',
            verdict: 'not_found',
            quote: undefined,
            checkedAt: '2026-09-11T00:00:00Z',
          }),
        ],
      }),
      'Part',
    );
    expect(parameterRows(part).find((entry) => entry.key === 'vinMax')?.verdict?.verdict).toBe(
      'confirmed',
    );
  });

  it('keeps the latest verdict per parameter, whichever order they are stored in', () => {
    const part = parseOrThrow(
      Part,
      partFixture({
        verifications: [
          verification({ parameterKey: 'vinMax', checkedAt: '2026-09-11T00:00:00Z' }),
          verification({
            parameterKey: 'vinMax',
            verdict: 'not_found',
            quote: undefined,
            checkedAt: '2026-09-12T00:00:00Z',
          }),
        ],
      }),
      'Part',
    );
    const row = parameterRows(part).find((entry) => entry.key === 'vinMax');
    expect(row?.verdict?.verdict).toBe('not_found');
  });
});

describe('payload shapes', () => {
  it('keeps the shape of a part summary', async () => {
    const result = await api.get('/api/parts?limit=1&sort=mpn');
    const [first] = (result.body as { items: unknown[] }).items;
    expect(first).toMatchSnapshot();
  });

  it('keeps the shape of a parameter row, with and without a verdict', async () => {
    const result = await api.get('/api/parts/AP62200WU-7/parameters');
    const rows = (result.body as { parameters: { key: string }[] }).parameters;
    expect(rows.find((row) => row.key === 'vinMax')).toMatchSnapshot();
    expect(rows.find((row) => row.key === 'rdsOnLow')).toMatchSnapshot();
  });

  it('keeps the shape of a conflicted parameter', async () => {
    const result = await api.get('/api/parts/LM5164QDDARQ1/parameters');
    const rows = (result.body as { parameters: { key: string }[] }).parameters;
    expect(rows.find((row) => row.key === 'rdsOnLow')).toMatchSnapshot();
  });

  it('keeps the shape of the coverage matrix and the totals', async () => {
    expect((await api.get('/api/catalog/totals')).body).toMatchSnapshot();
    const coverage = (await api.get('/api/catalog/coverage')).body as {
      coverage: { key: string }[];
    };
    expect(coverage.coverage.slice(0, 3)).toMatchSnapshot();
  });

  it('keeps the shape of a distribution', async () => {
    expect((await api.get('/api/catalog/distribution/vinMax?buckets=3')).body).toMatchSnapshot();
  });
});
