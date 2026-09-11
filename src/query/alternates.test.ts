import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buckParameters,
  distributorProvenance,
  offer,
  param,
  part,
  q,
  withConfidence,
} from '../../test/helpers/core-fixtures.js';
import { tryClassify } from '../classify/index.js';
import { Part, parseOrThrow } from '../core/index.js';
import { createRepositories, openDatabase, type Db, type Repositories } from '../db/index.js';
import { AlternateQuery } from './types.js';
import { DISCLAIMER, QueryError, findAlternates } from './alternates.js';

type Loose = Record<string, unknown>;

let db: Db;
let repositories: Repositories;

/**
 * A stored part built from the fixture, with its classifications derived the
 * way the pipeline derives them, so the filters see what they would see.
 */
function store(overrides: Loose = {}, parameterOverrides: Loose = {}): Part {
  const status = (overrides.status as string | undefined) ?? 'verified';
  const parameters = buckParameters(parameterOverrides);
  const stored = parseOrThrow(
    Part,
    part({
      parameters: status === 'verified' ? withConfidence(parameters, 'verified') : parameters,
      classifications: [...tryClassify(parameters).classifications],
      status,
      ...overrides,
    }),
    'part',
  );
  return repositories.parts.upsertPart(stored);
}

/** The same offer at another distributor, cheaper. */
function cheaper(unitPrice: number, currency = 'AUD'): Loose {
  return offer({
    distributor: 'mouser',
    sku: '595-CHEAP',
    currency,
    priceBreaks: [{ quantity: 1, unitPrice }],
    provenance: distributorProvenance({ distributor: 'mouser', sku: '595-CHEAP' }),
  });
}

function query(overrides: Loose = {}): AlternateQuery {
  return AlternateQuery.parse({
    mpn: 'TPS54331DR',
    quantity: 100,
    currency: 'AUD',
    ...overrides,
  });
}

beforeEach(() => {
  db = openDatabase(':memory:');
  repositories = createRepositories(db);
});

afterEach(() => {
  db.close();
});

describe('findAlternates', () => {
  it('refuses a reference part nobody has stored', () => {
    expect(() => findAlternates(repositories, query())).toThrow(QueryError);
  });

  it('says the disclaimer even when it has nothing to offer', () => {
    store();

    const result = findAlternates(repositories, query());

    expect(result.alternates).toEqual([]);
    expect(result.disclaimer).toBe(DISCLAIMER);
    expect(result.disclaimer).toContain('not pin compatibility');
    expect(result.reference.mpn).toBe('TPS54331DR');
    expect(result.referencePrice?.amount).toBe(1.42);
  });

  it('offers a cheaper part that covers the range, and says how much cheaper', () => {
    store();
    store({ mpn: 'LM5164DDAR', offers: [cheaper(0.71)] });

    const result = findAlternates(
      repositories,
      query({ vinRange: { unit: 'V', min: 4, max: 28 } }),
    );

    expect(result.alternates.map((one) => one.part.mpn)).toEqual(['LM5164DDAR']);
    expect(result.alternates[0]?.price).toMatchObject({ amount: 0.71, distributor: 'mouser' });
    expect(result.alternates[0]?.saving).toBeCloseTo(0.5, 5);
    expect(result.alternates[0]?.pinCompatibility).toBe('not_assessed');
  });

  it('never offers the reference as its own alternate', () => {
    store({ offers: [cheaper(0.1)] });

    expect(findAlternates(repositories, query()).alternates).toEqual([]);
  });

  it('filters on the input range at the boundary', () => {
    store();
    store({ mpn: 'LM5164DDAR', offers: [cheaper(0.71)] });

    const exact = findAlternates(
      repositories,
      query({ vinRange: { unit: 'V', min: 3.5, max: 28 } }),
    );
    const oneVoltMore = findAlternates(
      repositories,
      query({ vinRange: { unit: 'V', min: 3.5, max: 29 } }),
    );
    const oneVoltLower = findAlternates(
      repositories,
      query({ vinRange: { unit: 'V', min: 3.4, max: 28 } }),
    );

    expect(exact.alternates).toHaveLength(1);
    expect(oneVoltMore.alternates).toEqual([]);
    expect(oneVoltLower.alternates).toEqual([]);
  });

  it('filters on output current at the boundary', () => {
    store();
    store({ mpn: 'LM5164DDAR', offers: [cheaper(0.71)] });

    expect(
      findAlternates(repositories, query({ ioutMin: { value: 3, unit: 'A' } })).alternates,
    ).toHaveLength(1);
    expect(
      findAlternates(repositories, query({ ioutMin: { value: 3.1, unit: 'A' } })).alternates,
    ).toEqual([]);
  });

  it('filters on the classification axes and on every feature asked for', () => {
    store();
    store({ mpn: 'LM5164DDAR', offers: [cheaper(0.71)] });

    expect(
      findAlternates(repositories, query({ topology: 'non_synchronous' })).alternates,
    ).toHaveLength(1);
    expect(findAlternates(repositories, query({ topology: 'synchronous' })).alternates).toEqual([]);
    expect(findAlternates(repositories, query({ integration: 'controller' })).alternates).toEqual(
      [],
    );
    expect(
      findAlternates(repositories, query({ outputType: 'adjustable' })).alternates,
    ).toHaveLength(1);
    expect(findAlternates(repositories, query({ outputType: 'fixed' })).alternates).toEqual([]);
    expect(findAlternates(repositories, query({ packageFamily: 'soic' })).alternates).toHaveLength(
      1,
    );
    expect(findAlternates(repositories, query({ packageFamily: 'qfn' })).alternates).toEqual([]);
    expect(
      findAlternates(repositories, query({ temperatureGrade: 'extended' })).alternates,
    ).toHaveLength(1);
    expect(
      findAlternates(repositories, query({ temperatureGrade: 'automotive' })).alternates,
    ).toEqual([]);
    expect(findAlternates(repositories, query({ features: ['enable'] })).alternates).toHaveLength(
      1,
    );
    expect(
      findAlternates(repositories, query({ features: ['enable', 'power_good'] })).alternates,
    ).toEqual([]);
  });

  it('ranks by unit price at the quantity asked about', () => {
    store();
    store({ mpn: 'AAA-CHEAP', offers: [cheaper(0.5)] });
    store({ mpn: 'ZZZ-DEARER', offers: [cheaper(1.2)] });

    const result = findAlternates(repositories, query());

    expect(result.alternates.map((one) => one.part.mpn)).toEqual(['AAA-CHEAP', 'ZZZ-DEARER']);
  });

  it('offers a part with no price in that currency, last and unranked', () => {
    store();
    store({ mpn: 'AAA-DEARER', offers: [cheaper(2.5)] });
    store({ mpn: 'ZZZ-NOPRICE', offers: [cheaper(0.1, 'USD')] });

    const result = findAlternates(repositories, query());

    expect(result.alternates.map((one) => one.part.mpn)).toEqual(['AAA-DEARER', 'ZZZ-NOPRICE']);
    expect(result.alternates[1]?.price).toBeNull();
    expect(result.alternates[1]?.saving).toBeNull();
  });

  it('sorts two parts of the same price, and two with no price, by part number', () => {
    store();
    store({ mpn: 'BBB-SAME', offers: [cheaper(0.5)] });
    store({ mpn: 'AAA-SAME', offers: [cheaper(0.5)] });
    store({ mpn: 'DDD-NONE', offers: [] });
    store({ mpn: 'CCC-NONE', offers: [] });

    expect(findAlternates(repositories, query()).alternates.map((one) => one.part.mpn)).toEqual([
      'AAA-SAME',
      'BBB-SAME',
      'CCC-NONE',
      'DDD-NONE',
    ]);
  });

  it('leaves out a part nothing has verified unless asked', () => {
    store();
    store({ mpn: 'LM5164DDAR', status: 'extracted', offers: [cheaper(0.71)] });

    const strict = findAlternates(repositories, query());
    const loose = findAlternates(repositories, query({ includeUnverified: true }));

    expect(strict.alternates).toEqual([]);
    expect(strict.excluded).toEqual([{ mpn: 'LM5164DDAR', reason: 'not verified' }]);
    expect(loose.alternates.map((one) => one.part.mpn)).toEqual(['LM5164DDAR']);
  });

  it('never offers a part that needs a person, however cheap', () => {
    store();
    store({
      mpn: 'LM5164DDAR',
      status: 'needs_human',
      offers: [cheaper(0.01)],
    });

    const result = findAlternates(repositories, query({ includeUnverified: true }));

    expect(result.alternates).toEqual([]);
    expect(result.excluded).toEqual([{ mpn: 'LM5164DDAR', reason: 'status needs_human' }]);
  });

  it('compares every parameter against the reference, and says which agree', () => {
    store();
    store({ mpn: 'LM5164DDAR', offers: [cheaper(0.71)] }, { vinMax: param(q(29, 'V'), 4) });

    const [alternate] = findAlternates(repositories, query()).alternates;
    const vinMax = alternate?.comparison.find((one) => one.key === 'vinMax');
    const vinMin = alternate?.comparison.find((one) => one.key === 'vinMin');

    expect(alternate?.comparison).toHaveLength(30);
    expect(vinMax).toEqual({
      key: 'vinMax',
      reference: { value: 28, unit: 'V' },
      candidate: { value: 29, unit: 'V' },
      same: false,
    });
    expect(vinMin?.same).toBe(true);
  });

  it('returns no more than it was asked for', () => {
    store();
    for (const mpn of ['A1', 'B2', 'C3', 'D4']) {
      store({ mpn, offers: [cheaper(0.5)] });
    }

    expect(findAlternates(repositories, query({ limit: 2 })).alternates).toHaveLength(2);
  });
});
