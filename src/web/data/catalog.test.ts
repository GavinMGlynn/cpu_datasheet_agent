import { describe, expect, it } from 'vitest';

import {
  buckParameters,
  conflict,
  distributorProvenance,
  humanProvenance,
  offer,
  param,
  part as partFixture,
  q,
  verification,
  withConfidence,
  type Loose,
} from '../../../test/helpers/core-fixtures.js';
import { Part } from '../../core/part.js';
import { parseOrThrow } from '../../core/validation-error.js';
import {
  DEFAULT_PRICING,
  catalogTotals,
  parameterCoverage,
  parameterDistribution,
  parameterPoints,
  summarisePart,
  summariseParts,
  verdictCounts,
} from './catalog.js';

function part(overrides: Loose = {}): Part {
  return parseOrThrow(Part, partFixture(overrides), 'Part');
}

const tps = part();

describe('summarisePart', () => {
  it('counts what the extraction found and where it came from', () => {
    const summary = summarisePart(tps);
    expect(summary.parameters).toStrictEqual({
      stated: 28,
      cited: 30,
      verified: 0,
      conflicted: 0,
      total: 30,
    });
  });

  it('carries the datasheet, the classifications and the headline values', () => {
    const summary = summarisePart(tps);
    expect(summary.datasheet?.pageCount).toBe(40);
    expect(summary.classifications).toStrictEqual({ vinClass: 'le_42v' });
    expect(summary.headline.vinMax).toStrictEqual({ value: 28, unit: 'V' });
    expect(summary.headline.package).toBe('SOIC-8');
  });

  it('prices at the quantity asked for, in the currency asked for', () => {
    expect(summarisePart(tps, { quantity: 100, currency: 'AUD' }).bestPrice).toMatchObject({
      amount: 1.42,
      breakQuantity: 100,
    });
    expect(summarisePart(tps, { quantity: 100, currency: 'USD' }).bestPrice).toBeNull();
    expect(summarisePart(tps).bestPrice?.breakQuantity).toBe(1);
    expect(DEFAULT_PRICING).toStrictEqual({ quantity: 1, currency: 'AUD' });
  });

  it('adds up the offers and the stock behind them', () => {
    const twoOffers = part({
      offers: [
        offer(),
        offer({
          distributor: 'mouser',
          sku: '595-TPS54331DR',
          stock: 500,
          provenance: distributorProvenance({ distributor: 'mouser', sku: '595-TPS54331DR' }),
        }),
      ],
    });
    const summary = summarisePart(twoOffers);
    expect(summary.offerCount).toBe(2);
    expect(summary.distributors).toStrictEqual(['digikey', 'mouser']);
    expect(summary.stock).toBe(12_500);
  });

  it('copes with a part that has no datasheet, and counts nothing as cited', () => {
    const byHand: Loose = {};
    for (const [key, value] of Object.entries(buckParameters())) {
      byHand[key] = { ...(value as Loose), provenance: humanProvenance() };
    }
    const bare = part({ datasheet: undefined, parameters: byHand });
    const summary = summarisePart(bare);
    expect(summary.datasheet).toBeUndefined();
    expect(summary.parameters.cited).toBe(0);
  });

  it('counts a parameter in conflict and one a person confirmed', () => {
    const disputed = part({
      status: 'needs_human',
      parameters: {
        ...withConfidence(buckParameters(), 'verified'),
        vinMax: { ...param(q(28, 'V')), confidence: 'conflict', conflicts: [conflict()] },
      },
    });
    expect(summarisePart(disputed).parameters).toMatchObject({ verified: 29, conflicted: 1 });
  });

  it('summarises a list in one call', () => {
    expect(summariseParts([tps, tps])).toHaveLength(2);
    expect(summariseParts([])).toStrictEqual([]);
  });
});

describe('verdictCounts', () => {
  it('counts nothing checked as unchecked', () => {
    expect(verdictCounts(tps)).toStrictEqual({
      confirmed: 0,
      contradicted: 0,
      notFound: 0,
      unchecked: 30,
    });
  });

  it('keeps the latest verdict whichever order the verifications arrive in', () => {
    const newestFirst = part({
      verifications: [
        verification({ parameterKey: 'vinMax', verdict: 'confirmed', checkedAt: '2026-09-11T00:00:00Z' }),
        verification({ parameterKey: 'vinMax', verdict: 'contradicted', checkedAt: '2026-09-10T00:00:00Z' }),
      ],
    });
    expect(verdictCounts(newestFirst)).toMatchObject({ confirmed: 1, contradicted: 0 });
  });

  it('counts each verdict once and keeps only the latest per parameter', () => {
    const checked = part({
      verifications: [
        verification({ parameterKey: 'vinMax', verdict: 'contradicted', checkedAt: '2026-09-10T00:00:00Z' }),
        verification({ parameterKey: 'vinMax', verdict: 'confirmed', checkedAt: '2026-09-11T00:00:00Z' }),
        verification({ parameterKey: 'vinMin', verdict: 'not_found', quote: undefined }),
        verification({ parameterKey: 'ioutMax', verdict: 'contradicted' }),
      ],
    });
    expect(verdictCounts(checked)).toStrictEqual({
      confirmed: 1,
      contradicted: 1,
      notFound: 1,
      unchecked: 27,
    });
  });
});

describe('parameterCoverage', () => {
  it('reports every key against every part', () => {
    const cells = parameterCoverage([tps]);
    expect(cells).toHaveLength(30);
    const vinMax = cells.find((cell) => cell.key === 'vinMax');
    expect(vinMax).toMatchObject({ stated: 1, cited: 1, parts: 1, coverage: 1 });
    const rdsOnLow = cells.find((cell) => cell.key === 'rdsOnLow');
    expect(rdsOnLow).toMatchObject({ stated: 0, coverage: 0 });
  });

  it('does not count a page cited for a value the datasheet never states', () => {
    // voutFixed is read from page 1 and found to be absent: the part is
    // adjustable. Counting that as a citation would report a page cited for a
    // value nothing stated.
    const voutFixed = parameterCoverage([tps]).find((cell) => cell.key === 'voutFixed');
    expect(voutFixed).toMatchObject({ stated: 0, cited: 0, verified: 0, conflicted: 0 });
    expect(tps.parameters.voutFixed.provenance.source).toBe('datasheet');
  });

  it('counts conflicts and contradictions, which is what sends a part back', () => {
    const disputed = part({
      status: 'needs_human',
      parameters: buckParameters({
        vinMax: { ...param(q(28, 'V')), confidence: 'conflict', conflicts: [conflict()] },
      }),
      verifications: [verification({ parameterKey: 'vinMin', verdict: 'contradicted' })],
    });
    const cells = parameterCoverage([disputed, tps]);
    expect(cells.find((cell) => cell.key === 'vinMax')).toMatchObject({ conflicted: 1, parts: 2 });
    expect(cells.find((cell) => cell.key === 'vinMin')).toMatchObject({ contradicted: 1 });
  });

  it('counts what a verification pass confirmed, latest verdict only', () => {
    const verified = part({
      mpn: 'AP63203WU-7',
      status: 'verified',
      parameters: withConfidence(buckParameters(), 'verified'),
      verifications: [
        verification({ parameterKey: 'vinMax', verdict: 'contradicted', checkedAt: '2026-09-10T00:00:00Z' }),
        verification({ parameterKey: 'vinMax', verdict: 'confirmed', checkedAt: '2026-09-11T00:00:00Z' }),
      ],
    });
    const cells = parameterCoverage([verified]);
    expect(cells.find((cell) => cell.key === 'vinMax')).toMatchObject({
      verified: 1,
      contradicted: 0,
    });
  });

  it('does not count a value a person entered as cited', () => {
    const byHand: Loose = {};
    for (const [key, value] of Object.entries(buckParameters())) {
      byHand[key] = { ...(value as Loose), provenance: humanProvenance() };
    }
    const bare = part({ datasheet: undefined, parameters: byHand });
    expect(parameterCoverage([bare])[0]).toMatchObject({ stated: 1, cited: 0 });
  });

  it('has no coverage to report for no parts', () => {
    expect(parameterCoverage([])[0]).toMatchObject({ stated: 0, parts: 0, coverage: 0 });
  });
});

describe('distributions', () => {
  it('reads a quantity, a range and a one-sided bound', () => {
    const ranged = part({
      mpn: 'LM5164DDAR',
      parameters: buckParameters({
        switchingFrequency: param({ unit: 'Hz', min: 456_000, max: 684_000, typ: 570_000 }, 5),
      }),
    });
    const bounded = part({
      mpn: 'TPS62130RGTR',
      parameters: buckParameters({ switchingFrequency: param({ unit: 'Hz', max: 1_000_000 }, 6) }),
    });
    const points = parameterPoints([tps, ranged, bounded], 'switchingFrequency');
    expect(points).toStrictEqual([
      { mpn: 'TPS54331DR', min: 570_000, max: 570_000, unit: 'Hz' },
      { mpn: 'LM5164DDAR', min: 456_000, max: 684_000, unit: 'Hz' },
      { mpn: 'TPS62130RGTR', min: undefined, max: 1_000_000, unit: 'Hz' },
    ]);
  });

  it('takes the stated end of a bound that states only a minimum', () => {
    const floor = part({
      mpn: 'LM76002RNPR',
      parameters: buckParameters({ switchingFrequency: param({ unit: 'Hz', min: 200_000 }, 5) }),
    });
    const distribution = parameterDistribution([floor], 'switchingFrequency');
    expect(distribution.summary?.min).toBe(200_000);
  });

  it('summarises the values and buckets them', () => {
    const distribution = parameterDistribution([tps, part({ mpn: 'TPS54560BDDAR' })], 'vinMax', 4);
    expect(distribution.unit).toBe('V');
    expect(distribution.summary?.count).toBe(2);
    expect(distribution.buckets).toHaveLength(1);
    expect(distribution.nonNumeric).toBe(0);
  });

  it('counts the parts whose value is not a number at all', () => {
    const distribution = parameterDistribution([tps], 'topology');
    expect(distribution.points).toStrictEqual([]);
    expect(distribution.summary).toBeUndefined();
    expect(distribution.unit).toBeUndefined();
    expect(distribution.nonNumeric).toBe(1);
  });
});

describe('catalogTotals', () => {
  it('adds up the whole set', () => {
    const other = part({
      mpn: 'AP62200WU-7',
      manufacturer: 'Diodes Incorporated',
      status: 'verified',
      parameters: withConfidence(buckParameters(), 'verified'),
    });
    const totals = catalogTotals([tps, other]);
    expect(totals).toMatchObject({
      parts: 2,
      parametersStated: 56,
      parametersCited: 60,
      offers: 2,
      datasheets: 1,
      byStatus: { extracted: 1, verified: 1 },
      byManufacturer: { 'Diodes Incorporated': 1, 'Texas Instruments': 1 },
      byCategory: { buck_regulator: 2 },
    });
  });

  it('counts a part with no datasheet without counting a datasheet', () => {
    const byHand: Loose = {};
    for (const [key, value] of Object.entries(buckParameters())) {
      byHand[key] = { ...(value as Loose), provenance: humanProvenance() };
    }
    const bare = part({ mpn: 'MCP16331T-E/CH', datasheet: undefined, parameters: byHand });
    expect(catalogTotals([bare])).toMatchObject({ parts: 1, datasheets: 0, parametersCited: 0 });
  });

  it('adds up nothing without dividing by it', () => {
    expect(catalogTotals([])).toMatchObject({ parts: 0, datasheets: 0, byStatus: {} });
  });
});
