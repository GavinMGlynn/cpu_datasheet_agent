import { describe, expect, it } from 'vitest';

import { loadGoldenSet } from './load.js';
import { scorePart, scoreSet, sameValue } from './scorer.js';
import type { ParameterSet } from '../reconcile/types.js';
import type { GoldenPart } from './golden.js';

const [first] = loadGoldenSet();
if (first === undefined) {
  throw new Error('the golden set is empty');
}
const GOLDEN: GoldenPart = first.part;

function extractionOf(golden: GoldenPart, overrides: Partial<ParameterSet> = {}): ParameterSet {
  return { ...golden.parameters, ...overrides };
}

describe('sameValue', () => {
  it('accepts a number inside the parameter’s own tolerance and refuses one outside it', () => {
    // vinMax allows two percent, as reconciliation does.
    expect(sameValue('vinMax', { value: 28, unit: 'V' }, { value: 28.4, unit: 'V' })).toBe(true);
    expect(sameValue('vinMax', { value: 28, unit: 'V' }, { value: 30, unit: 'V' })).toBe(false);
  });

  it('refuses a number against something that is not one', () => {
    expect(sameValue('vinMax', { value: 28, unit: 'V' }, 'twenty-eight')).toBe(false);
    expect(sameValue('vinMax', 'twenty-eight', { value: 28, unit: 'V' })).toBe(false);
  });

  it('refuses a number in the wrong unit', () => {
    expect(sameValue('vinMax', { value: 28, unit: 'V' }, { value: 28, unit: 'A' } as never)).toBe(
      false,
    );
  });

  it('compares enums, booleans and packages exactly', () => {
    expect(sameValue('topology', 'synchronous', 'synchronous')).toBe(true);
    expect(sameValue('topology', 'synchronous', 'non_synchronous')).toBe(false);
    expect(sameValue('enablePin', true, true)).toBe(true);
    expect(sameValue('package', '8-SOIC (D)', '8-SOIC')).toBe(true);
  });

  it('compares a package by what it is, not by how it is written', () => {
    // The same package, named the way a datasheet names it and the way an
    // ordering table does.
    expect(sameValue('package', '6-TSOT26', 'TSOT26')).toBe(true);
    expect(sameValue('package', '20-HTSSOP (PWP)', 'HTSSOP-20')).toBe(true);
    // A different family, or a stated pin count that disagrees.
    expect(sameValue('package', '8-SOIC (D)', '8-VSSOP')).toBe(false);
    expect(sameValue('package', '8-SOIC', '14-SOIC')).toBe(false);
    // Nothing canonical to compare: the words are all there is.
    expect(sameValue('package', 'MLF-16', 'MLF-16')).toBe(true);
    expect(sameValue('package', 'MLF-16', 'TMLF-16')).toBe(false);
  });

  it('treats null as a value in its own right', () => {
    expect(sameValue('rdsOnLow', null, null)).toBe(true);
    expect(sameValue('rdsOnLow', null, { value: 0.05, unit: 'Ohm' })).toBe(false);
    expect(sameValue('rdsOnLow', { value: 0.05, unit: 'Ohm' }, null)).toBe(false);
  });

  it('compares soft start on presence and time', () => {
    const present = { present: true, time: { value: 0.004, unit: 's' } } as const;
    expect(
      sameValue('softStart', present, { present: true, time: { value: 0.004, unit: 's' } }),
    ).toBe(true);
    expect(sameValue('softStart', present, { present: true, time: null })).toBe(false);
    expect(sameValue('softStart', present, { present: false, time: null })).toBe(false);
    expect(
      sameValue('softStart', { present: true, time: null }, { present: true, time: null }),
    ).toBe(true);
  });

  it('compares ranges and limits end by end', () => {
    const range = { unit: 'Hz', min: 100_000, max: 1_500_000 } as const;
    expect(
      sameValue('switchingFrequency', range, { unit: 'Hz', min: 100_000, max: 1_500_000 }),
    ).toBe(true);
    expect(
      sameValue('switchingFrequency', range, { unit: 'Hz', min: 100_000, max: 2_200_000 }),
    ).toBe(false);
    const limit = { unit: 'Hz', max: 1_000_000 } as const;
    expect(sameValue('switchingFrequency', limit, { unit: 'Hz', max: 1_000_000 })).toBe(true);
    expect(sameValue('switchingFrequency', limit, { unit: 'Hz', min: 1_000_000 })).toBe(false);
    expect(sameValue('switchingFrequency', limit, range)).toBe(false);
    const lower = { unit: 'Hz', min: 100_000 } as const;
    expect(sameValue('switchingFrequency', lower, { unit: 'Hz', min: 100_000 })).toBe(true);
    expect(sameValue('switchingFrequency', lower, { unit: 'Hz', min: 300_000 })).toBe(false);
  });
});

describe('scorePart', () => {
  it('scores a perfect extraction as perfect', () => {
    const score = scorePart(GOLDEN, extractionOf(GOLDEN));

    expect(score.mpn).toBe(GOLDEN.mpn);
    expect(score.recall).toBe(1);
    expect(score.precision).toBe(1);
    expect(score.provenanceAccuracy).toBe(1);
    expect(score.parameters.every((one) => one.score === 'correct' || one.score === 'absent')).toBe(
      true,
    );
  });

  it('calls a wrong number wrong, and keeps both values for the reader', () => {
    const wrong = extractionOf(GOLDEN, {
      vinMax: { ...GOLDEN.parameters.vinMax, value: { value: 60, unit: 'V' } },
    });

    const score = scorePart(GOLDEN, wrong);
    const vinMax = score.parameters.find((one) => one.key === 'vinMax');

    expect(vinMax?.score).toBe('wrong');
    expect(vinMax?.actual).toEqual({ value: 60, unit: 'V' });
    expect(vinMax?.expected).toEqual(GOLDEN.parameters.vinMax.value);
    expect(score.recall).toBeLessThan(1);
  });

  it('calls a parameter the extraction left out missing', () => {
    const withoutVinMax = extractionOf(GOLDEN);
    delete (withoutVinMax as Record<string, unknown>).vinMax;

    const score = scorePart(GOLDEN, withoutVinMax);

    expect(score.parameters.find((one) => one.key === 'vinMax')?.score).toBe('missing');
    expect(score.precision).toBe(1);
    expect(score.recall).toBeLessThan(1);
  });

  it('calls a value invented where the datasheet says nothing extra', () => {
    const key = GOLDEN.parameters.efficiencyPeak.value === null ? 'efficiencyPeak' : 'minOnTime';
    const invented = extractionOf(GOLDEN, {
      [key]: { ...GOLDEN.parameters[key], value: { value: 95, unit: 'percent' } },
    });

    const score = scorePart(GOLDEN, invented);

    expect(score.parameters.find((one) => one.key === key)?.score).toBe('extra');
    expect(score.precision).toBeLessThan(1);
  });

  it('scores the citation separately, with a bucket for one page out', () => {
    const page = (offset: number): ParameterSet =>
      extractionOf(GOLDEN, {
        vinMax: {
          ...GOLDEN.parameters.vinMax,
          provenance: {
            ...GOLDEN.parameters.vinMax.provenance,
            page:
              (GOLDEN.parameters.vinMax.provenance.source === 'datasheet'
                ? GOLDEN.parameters.vinMax.provenance.page
                : 1) + offset,
          },
        },
      } as Partial<ParameterSet>);

    const near = scorePart(GOLDEN, page(1)).parameters.find((one) => one.key === 'vinMax');
    const far = scorePart(GOLDEN, page(7)).parameters.find((one) => one.key === 'vinMax');

    expect(near?.page).toBe('within_one');
    expect(far?.page).toBe('wrong');
    expect(scorePart(GOLDEN, page(1)).provenanceAccuracy).toBeLessThan(1);
  });

  it('says nothing was cited when the value came from somewhere else', () => {
    const fromDistributor = extractionOf(GOLDEN, {
      vinMax: {
        ...GOLDEN.parameters.vinMax,
        provenance: {
          source: 'distributor',
          distributor: 'digikey',
          sku: '296-1234-ND',
          fetchedAt: '2026-09-11T00:00:00.000Z',
          cacheKey: 'a'.repeat(64),
        },
      },
    });

    expect(
      scorePart(GOLDEN, fromDistributor).parameters.find((one) => one.key === 'vinMax')?.page,
    ).toBe('none');
  });
});

describe('scoreSet', () => {
  it('totals the parts and reports each parameter separately', () => {
    const scores = loadGoldenSet().map(({ part }) => scorePart(part, extractionOf(part)));

    const total = scoreSet(scores);

    expect(total.parts).toHaveLength(scores.length);
    expect(total.recall).toBe(1);
    expect(total.precision).toBe(1);
    expect(total.provenanceAccuracy).toBe(1);
    expect(total.withinOnePage).toBe(0);
    expect(total.byParameter.vinMax.stated).toBe(scores.length);
    expect(total.byParameter.vinMax.correct).toBe(scores.length);
  });

  it('reports a run that stated nothing as scoring nothing rather than dividing by zero', () => {
    const empty = loadGoldenSet()
      .slice(0, 1)
      .map(({ part }) => scorePart(part, {}));

    const total = scoreSet(empty);

    expect(total.precision).toBe(1);
    expect(total.recall).toBe(0);
    expect(total.provenanceAccuracy).toBe(1);
  });
});
