import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buckParameters,
  classification,
  distributorProvenance,
  offer,
  part as partFixture,
  withConfidence,
  type Loose,
} from '../../../test/helpers/core-fixtures.js';
import { createTestApi, type TestApi } from '../../../test/helpers/web-api.js';
import { registerAlternates } from './alternates.js';

let api: TestApi;

const AXES = (): Loose[] => [
  classification({ axis: 'vinClass', value: 'le_42v' }),
  classification({ axis: 'ioutClass', value: 'le_3a', derivedFrom: ['ioutMax'] }),
  classification({ axis: 'topology', value: 'non_synchronous', derivedFrom: ['topology'] }),
  classification({ axis: 'integration', value: 'integrated_fet', derivedFrom: ['integration'] }),
  classification({ axis: 'outputType', value: 'adjustable', derivedFrom: ['voutFixed'] }),
  classification({ axis: 'packageFamily', value: 'soic', derivedFrom: ['package'] }),
  classification({
    axis: 'temperatureGrade',
    value: 'industrial',
    derivedFrom: ['operatingTempMin', 'operatingTempMax'],
  }),
  classification({ axis: 'features', value: ['enable'], derivedFrom: ['enablePin'] }),
];

function seedVerified(mpn: string, unitPrice: number, overrides: Loose = {}): void {
  api.repositories.parts.upsertPart(
    partFixture({
      mpn,
      status: 'verified',
      parameters: withConfidence(buckParameters(), 'verified'),
      classifications: AXES(),
      offers: [
        offer({
          sku: `sku-${mpn}`,
          priceBreaks: [{ quantity: 1, unitPrice }],
          provenance: distributorProvenance({ sku: `sku-${mpn}` }),
        }),
      ],
      ...overrides,
    }),
  );
}

beforeEach(async () => {
  api = await createTestApi({ register: registerAlternates });
  seedVerified('TPS54331DR', 2.31);
  seedVerified('AP63203WU-7', 0.94);
  api.repositories.parts.upsertPart(
    partFixture({
      mpn: 'LM5164DDAR',
      status: 'extracted',
      classifications: AXES(),
      offers: [
        offer({
          sku: 'sku-lm5164',
          priceBreaks: [{ quantity: 1, unitPrice: 0.5 }],
          provenance: distributorProvenance({ sku: 'sku-lm5164' }),
        }),
      ],
    }),
  );
});

afterEach(async () => {
  await api.close();
});

describe('POST /api/alternates', () => {
  it('answers with cheaper parts that still meet the constraints', async () => {
    const result = await api.post('/api/alternates', {
      mpn: 'TPS54331DR',
      vinRange: { unit: 'V', min: 8, max: 28 },
      ioutMin: { unit: 'A', value: 2 },
      quantity: 100,
      currency: 'AUD',
    });
    expect(result.status).toBe(200);
    const body = result.body as {
      result: { alternates: { part: { mpn: string } }[]; disclaimer: string };
    };
    expect(body.result.alternates.map((entry) => entry.part.mpn)).toStrictEqual(['AP63203WU-7']);
    expect(body.result.disclaimer).toMatch(/pin/iu);
  });

  it('leaves out a part no verification pass has confirmed, unless asked', async () => {
    const strict = await api.post('/api/alternates', {
      mpn: 'TPS54331DR',
      quantity: 1,
      currency: 'AUD',
    });
    const strictBody = strict.body as {
      result: { alternates: unknown[]; excluded: { mpn: string; reason: string }[] };
    };
    expect(strictBody.result.excluded).toContainEqual({
      mpn: 'LM5164DDAR',
      reason: 'not verified',
    });
    const loose = await api.post('/api/alternates', {
      mpn: 'TPS54331DR',
      quantity: 1,
      currency: 'AUD',
      includeUnverified: true,
    });
    const looseBody = loose.body as { result: { alternates: { part: { mpn: string } }[] } };
    expect(looseBody.result.alternates.map((entry) => entry.part.mpn)).toContain('LM5164DDAR');
  });

  it('refuses a query that is not one', async () => {
    const result = await api.post('/api/alternates', { mpn: 'TPS54331DR' });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('says when the part to be replaced is not stored', async () => {
    const result = await api.post('/api/alternates', {
      mpn: 'NOTHING-1',
      quantity: 1,
      currency: 'AUD',
    });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: { code: 'QUERY_PART_NOT_STORED' } });
  });
});

describe('GET /api/alternates', () => {
  it('answers the same question from a link', async () => {
    const result = await api.get(
      '/api/alternates?mpn=TPS54331DR&vin=8-28&iout=2&quantity=100&currency=AUD',
    );
    expect(result.status).toBe(200);
    const body = result.body as { result: { alternates: { part: { mpn: string } }[] } };
    expect(body.result.alternates.map((entry) => entry.part.mpn)).toStrictEqual(['AP63203WU-7']);
  });

  it('takes every constraint the schema has', async () => {
    const result = await api.get(
      '/api/alternates?mpn=TPS54331DR&topology=non_synchronous&outputType=adjustable' +
        '&integration=integrated_fet&packageFamily=soic&temperatureGrade=industrial' +
        '&features=enable&quantity=1&currency=AUD&includeUnverified=true&limit=3',
    );
    expect(result.status).toBe(200);
    const body = result.body as { result: { alternates: unknown[] } };
    expect(body.result.alternates.length).toBeGreaterThan(0);
  });

  it('refuses a range that is not written as one', async () => {
    const result = await api.get('/api/alternates?mpn=TPS54331DR&vin=eight-to-28');
    expect(result.status).toBe(400);
    expect(result.text).toContain('expected a range such as 8-28');
  });

  it('refuses a constraint that is not a value the schema knows', async () => {
    expect((await api.get('/api/alternates?mpn=TPS54331DR&topology=magic')).status).toBe(400);
  });
});

describe('GET /api/alternates/constraints', () => {
  it('says what a form can offer, from the schema rather than a restatement', async () => {
    const result = await api.get('/api/alternates/constraints');
    const body = result.body as { manufacturers: string[]; shape: string[] };
    expect(body.manufacturers).toStrictEqual(['Texas Instruments']);
    expect(body.shape).toContain('vinRange');
    expect(body.shape).toContain('includeUnverified');
  });
});

describe('payload shape', () => {
  it('keeps the shape of an answer', async () => {
    const body = (
      await api.post('/api/alternates', {
        mpn: 'TPS54331DR',
        quantity: 100,
        currency: 'AUD',
      })
    ).body as { result: Record<string, unknown> };
    expect(Object.keys(body.result).sort()).toMatchSnapshot();
  });
});
