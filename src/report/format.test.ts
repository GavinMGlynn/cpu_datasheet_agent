import { describe, expect, it } from 'vitest';

import {
  NOT_STATED,
  citedPage,
  citedQuote,
  formatParameterValue,
  formatPrice,
  formatProvenance,
  isQuantity,
  isRange,
  isSoftStart,
} from './format.js';

describe('type guards', () => {
  it('recognise the shapes a parameter value can take', () => {
    expect(isQuantity({ value: 1, unit: 'V' })).toBe(true);
    expect(isQuantity({ unit: 'V', min: 1, max: 2 })).toBe(false);
    expect(isQuantity(null)).toBe(false);
    expect(isQuantity('3.3V')).toBe(false);

    expect(isRange({ unit: 'Hz', min: 1, max: 2 })).toBe(true);
    expect(isRange({ value: 1, unit: 'Hz' })).toBe(false);
    expect(isRange(null)).toBe(false);

    expect(isSoftStart({ present: true, time: null })).toBe(true);
    expect(isSoftStart({ present: true })).toBe(false);
    expect(isSoftStart(null)).toBe(false);
  });
});

describe('formatParameterValue', () => {
  it('writes a quantity in engineering notation, as a datasheet would', () => {
    expect(formatParameterValue({ value: 570_000, unit: 'Hz' })).toBe('570 kHz');
    expect(formatParameterValue({ value: 0.00007, unit: 'A' })).toBe('70 µA');
    expect(formatParameterValue({ value: -40, unit: 'degC' })).toBe('-40 °C');
  });

  it('writes a range with both ends', () => {
    expect(formatParameterValue({ unit: 'Hz', min: 100_000, max: 2_200_000 })).toBe(
      '100000 ~ 2200000 Hz',
    );
  });

  it('says plainly when a datasheet does not state a value', () => {
    expect(formatParameterValue(null)).toBe(NOT_STATED);
    expect(NOT_STATED).toBe('not stated');
  });

  it('writes booleans as yes and no', () => {
    expect(formatParameterValue(true)).toBe('yes');
    expect(formatParameterValue(false)).toBe('no');
  });

  it('passes enums and package names through', () => {
    expect(formatParameterValue('synchronous')).toBe('synchronous');
    expect(formatParameterValue('SOIC-8')).toBe('SOIC-8');
  });

  it('writes soft start with its time when there is one', () => {
    expect(formatParameterValue({ present: false, time: null })).toBe('no');
    expect(formatParameterValue({ present: true, time: null })).toBe('yes');
    expect(formatParameterValue({ present: true, time: { value: 0.002, unit: 's' } })).toBe(
      'yes, 2 ms',
    );
  });

  it('falls back to JSON for a shape it does not know', () => {
    expect(formatParameterValue({ unexpected: 1 })).toBe('{"unexpected":1}');
    expect(formatParameterValue(42)).toBe('42');
  });
});

describe('formatProvenance', () => {
  it('names the page for a datasheet value', () => {
    expect(
      formatProvenance({ source: 'datasheet', sha256: 'a'.repeat(64), page: 4, method: 'text' }),
    ).toBe('datasheet page 4 (text)');
    expect(
      formatProvenance({ source: 'datasheet', sha256: 'a'.repeat(64), page: 12, method: 'image' }),
    ).toBe('datasheet page 12 (image)');
  });

  it('names the distributor and SKU', () => {
    expect(
      formatProvenance({
        source: 'distributor',
        distributor: 'digikey',
        sku: '296-26991-1-ND',
        fetchedAt: '2026-09-10T00:00:00Z',
        cacheKey: 'b'.repeat(64),
      }),
    ).toBe('digikey 296-26991-1-ND');
  });

  it('names the person and the rule for the other kinds', () => {
    expect(
      formatProvenance({
        source: 'human',
        note: 'read by hand',
        recordedAt: '2026-09-10T00:00:00Z',
      }),
    ).toBe('recorded by hand: read by hand');
    expect(
      formatProvenance({ source: 'derived', from: ['vinMin', 'vinMax'], rule: 'vin-class.v1' }),
    ).toBe('derived by vin-class.v1 from vinMin, vinMax');
  });
});

describe('citations', () => {
  const datasheet = {
    source: 'datasheet',
    sha256: 'a'.repeat(64),
    page: 4,
    method: 'text',
  } as const;

  it('reports the page and quote only for datasheet values', () => {
    expect(citedPage(datasheet)).toBe(4);
    expect(citedQuote({ ...datasheet, quote: 'VIN 3.5 V to 28 V' })).toBe('VIN 3.5 V to 28 V');
    expect(citedQuote(datasheet)).toBeUndefined();

    const human = { source: 'human', note: 'x', recordedAt: '2026-09-10T00:00:00Z' } as const;
    expect(citedPage(human)).toBeUndefined();
    expect(citedQuote(human)).toBeUndefined();
  });
});

describe('formatPrice', () => {
  it('uses four decimals below a unit and two above, with the currency', () => {
    expect(formatPrice(2.36, 'AUD')).toBe('2.36 AUD');
    expect(formatPrice(0.9, 'AUD')).toBe('0.9000 AUD');
    expect(formatPrice(1, 'USD')).toBe('1.00 USD');
    expect(formatPrice(1.17679, 'AUD')).toBe('1.18 AUD');
  });
});
