import { describe, it } from 'vitest';

import { expectAccepts, expectRejects } from '../../test/helpers/schema.js';
import { Quantity, QuantityRange, UNITS, quantityOf, rangeOf } from './quantity.js';

describe('Quantity', () => {
  it.each(UNITS)('accepts a non-negative value in %s', (unit) => {
    expectAccepts(Quantity, { value: 0, unit });
    expectAccepts(Quantity, { value: 3.3, unit });
  });

  it('accepts negative temperatures and a percent of exactly 100', () => {
    expectAccepts(Quantity, { value: -40, unit: 'degC' });
    expectAccepts(Quantity, { value: 100, unit: 'percent' });
  });

  it('rejects negative values in every unit except degC', () => {
    for (const unit of UNITS.filter((candidate) => candidate !== 'degC')) {
      expectRejects(Quantity, { value: -1, unit }, 'value');
    }
  });

  it('rejects a percent above 100 but allows other units above 100', () => {
    expectRejects(Quantity, { value: 100.5, unit: 'percent' }, 'value');
    expectAccepts(Quantity, { value: 570000, unit: 'Hz' });
  });

  it.each([
    ['a string value', { value: '3.3', unit: 'V' }],
    ['a textual quantity', '3.3V'],
    ['a range written as text', '3 V to 32 V'],
    ['a missing unit', { value: 3.3 }],
    ['an unknown unit', { value: 3.3, unit: 'mV' }],
    ['a lowercase unit', { value: 3.3, unit: 'v' }],
    ['an extra key', { value: 3.3, unit: 'V', note: 'typ' }],
    ['NaN', { value: Number.NaN, unit: 'V' }],
    ['Infinity', { value: Number.POSITIVE_INFINITY, unit: 'V' }],
    ['null', null],
    ['an array', [3.3, 'V']],
  ])('rejects %s', (_label, value) => {
    expectRejects(Quantity, value);
  });
});

describe('quantityOf', () => {
  const volts = quantityOf('V');

  it('accepts only the pinned unit', () => {
    expectAccepts(volts, { value: 5, unit: 'V' });
    expectRejects(volts, { value: 5, unit: 'A' }, 'unit');
  });

  it('applies the magnitude rules', () => {
    expectRejects(volts, { value: -5, unit: 'V' }, 'value');
    expectRejects(quantityOf('percent'), { value: 101, unit: 'percent' }, 'value');
    expectAccepts(quantityOf('degC'), { value: -55, unit: 'degC' });
  });
});

describe('QuantityRange', () => {
  it('accepts min/max with an optional typical value', () => {
    expectAccepts(QuantityRange, { unit: 'Hz', min: 200000, max: 2200000 });
    expectAccepts(QuantityRange, { unit: 'Hz', min: 200000, max: 2200000, typ: 500000 });
    expectAccepts(QuantityRange, { unit: 'V', min: 1, max: 1, typ: 1 });
    expectAccepts(QuantityRange, { unit: 'degC', min: -40, max: 125, typ: 25 });
  });

  it('rejects max below min', () => {
    expectRejects(QuantityRange, { unit: 'Hz', min: 5, max: 4 }, 'max');
  });

  it('rejects typ outside the range on either side', () => {
    expectRejects(QuantityRange, { unit: 'Hz', min: 5, max: 10, typ: 4 }, 'typ');
    expectRejects(QuantityRange, { unit: 'Hz', min: 5, max: 10, typ: 11 }, 'typ');
  });

  it('applies the magnitude rules to min, max, and typ', () => {
    expectRejects(QuantityRange, { unit: 'V', min: -1, max: 5 }, 'min');
    expectRejects(QuantityRange, { unit: 'V', min: -2, max: -1 }, 'max');
    expectRejects(QuantityRange, { unit: 'percent', min: 0, max: 100, typ: 101 }, 'typ');
  });

  it.each([
    ['a single quantity', { value: 5, unit: 'V' }],
    ['text', '3 V to 32 V'],
    ['string bounds', { unit: 'V', min: '3', max: '32' }],
    ['an extra key', { unit: 'V', min: 3, max: 32, nominal: 5 }],
    ['a missing unit', { min: 3, max: 32 }],
  ])('rejects %s', (_label, value) => {
    expectRejects(QuantityRange, value);
  });
});

describe('rangeOf', () => {
  const hertz = rangeOf('Hz');

  it('accepts only the pinned unit and applies the range rules', () => {
    expectAccepts(hertz, { unit: 'Hz', min: 1, max: 2, typ: 1.5 });
    expectRejects(hertz, { unit: 'V', min: 1, max: 2 }, 'unit');
    expectRejects(hertz, { unit: 'Hz', min: 3, max: 2 }, 'max');
    expectRejects(hertz, { unit: 'Hz', min: 1, max: 2, typ: 3 }, 'typ');
  });
});
