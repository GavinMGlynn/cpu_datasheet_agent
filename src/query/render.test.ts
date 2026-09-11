import { describe, expect, it } from 'vitest';

import { buckParameters, offer, part, withConfidence } from '../../test/helpers/core-fixtures.js';
import { tryClassify } from '../classify/index.js';
import { Part, parseOrThrow } from '../core/index.js';
import { DISCLAIMER } from './alternates.js';
import { renderAlternates } from './render.js';
import type { Alternate, AlternateResult, UnitPrice } from './types.js';

function stored(mpn: string): Part {
  const parameters = buckParameters();
  return parseOrThrow(
    Part,
    part({
      mpn,
      parameters: withConfidence(parameters, 'verified'),
      classifications: [...tryClassify(parameters).classifications],
      status: 'verified',
      offers: [offer()],
    }),
    `part ${mpn}`,
  );
}

const price: UnitPrice = {
  amount: 0.71,
  currency: 'AUD',
  breakQuantity: 100,
  distributor: 'mouser',
  sku: '595-CHEAP',
  stock: 400,
};

function alternate(overrides: Partial<Alternate> = {}): Alternate {
  return {
    part: stored('LM5164DDAR'),
    price,
    saving: 0.5,
    comparison: [
      {
        key: 'vinMax',
        reference: { value: 28, unit: 'V' },
        candidate: { value: 60, unit: 'V' },
        same: false,
      },
      {
        key: 'vinMin',
        reference: { value: 3.5, unit: 'V' },
        candidate: { value: 3.5, unit: 'V' },
        same: true,
      },
    ],
    pinCompatibility: 'not_assessed',
    ...overrides,
  };
}

function result(overrides: Partial<AlternateResult> = {}): AlternateResult {
  return {
    reference: stored('TPS54331DR'),
    referencePrice: { ...price, amount: 1.42, distributor: 'digikey', sku: '296-1-ND' },
    alternates: [alternate()],
    excluded: [],
    disclaimer: DISCLAIMER,
    ...overrides,
  };
}

describe('renderAlternates', () => {
  it('names the reference, the candidate, the price and what differs', () => {
    const text = renderAlternates(result());

    expect(text).toContain('TPS54331DR — AUD 1.42 each at 100+ (digikey 296-1-ND)');
    expect(text).toContain('1. LM5164DDAR — AUD 0.71 each at 100+ (mouser 595-CHEAP)  50% cheaper');
    expect(text).toContain('status verified, pin compatibility not_assessed');
    expect(text).toContain('vinMax: {"value":28,"unit":"V"} → {"value":60,"unit":"V"}');
    expect(text).not.toContain('vinMin:');
  });

  it('ends with the disclaimer, every time', () => {
    expect(renderAlternates(result()).endsWith(DISCLAIMER)).toBe(true);
    expect(renderAlternates(result({ alternates: [] })).endsWith(DISCLAIMER)).toBe(true);
  });

  it('says plainly when nothing meets the constraints', () => {
    expect(renderAlternates(result({ alternates: [] }))).toContain(
      'No stored part meets those constraints.',
    );
  });

  it('does not call a dearer part cheaper', () => {
    const text = renderAlternates(result({ alternates: [alternate({ saving: -0.33 })] }));

    expect(text).toContain('33% dearer');
    expect(text).not.toContain('cheaper');
  });

  it('says when a part has no price in the currency asked about', () => {
    const text = renderAlternates(
      result({ alternates: [alternate({ price: null, saving: null })] }),
    );

    expect(text).toContain('no price in this currency');
    expect(text).not.toContain('cheaper');
  });

  it('lists what it did not offer, and why', () => {
    const text = renderAlternates(
      result({ excluded: [{ mpn: 'AP63205WU-7', reason: 'not verified' }] }),
    );

    expect(text).toContain('not offered: AP63205WU-7 (not verified)');
  });

  it('says a reference with no price has none', () => {
    expect(renderAlternates(result({ referencePrice: null }))).toContain(
      'TPS54331DR — no price in this currency',
    );
  });
});
