import { describe, expect, it } from 'vitest';

import { isBound, isQuantity, isRange, isSoftStart } from './value-shapes.js';

describe('isQuantity', () => {
  it.each([
    [{ value: 3.3, unit: 'V' }, true],
    [{ unit: 'Hz', min: 1, max: 2 }, false],
    [{ unit: 'Hz', max: 2 }, false],
    ['3.3 V', false],
    [null, false],
  ])('reads %j as %s', (value, expected) => {
    expect(isQuantity(value)).toBe(expected);
  });
});

describe('isRange', () => {
  it.each([
    [{ unit: 'Hz', min: 1, max: 2 }, true],
    [{ unit: 'Hz', min: 1, max: 2, typ: 1.5 }, true],
    [{ unit: 'Hz', max: 2 }, false],
    [{ value: 1, unit: 'Hz' }, false],
    [undefined, false],
  ])('reads %j as %s', (value, expected) => {
    expect(isRange(value)).toBe(expected);
  });
});

describe('isBound', () => {
  it.each([
    [{ unit: 'Hz', max: 1_000_000 }, true],
    [{ unit: 'Hz', min: 100_000 }, true],
    // Both ends is a range, not a bound, which is what keeps the two apart.
    [{ unit: 'Hz', min: 1, max: 2 }, false],
    [{ unit: 'Hz' }, false],
    [{ value: 1, unit: 'Hz' }, false],
    [null, false],
  ])('reads %j as %s', (value, expected) => {
    expect(isBound(value)).toBe(expected);
  });
});

describe('isSoftStart', () => {
  it.each([
    [{ present: true, time: null }, true],
    [{ present: false, time: null }, true],
    [{ present: true }, false],
    [{ time: null }, false],
    ['yes', false],
  ])('reads %j as %s', (value, expected) => {
    expect(isSoftStart(value)).toBe(expected);
  });
});
