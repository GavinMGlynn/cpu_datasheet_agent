import { describe, expect, it } from 'vitest';

import { numericBounds, parseJson } from './json.js';

describe('parseJson', () => {
  it('parses stored JSON text', () => {
    expect(parseJson('{"a":[1,"b"]}')).toEqual({ a: [1, 'b'] });
    expect(() => parseJson('{')).toThrow(SyntaxError);
  });
});

describe('numericBounds', () => {
  it('extracts a quantity as a degenerate range', () => {
    expect(numericBounds({ value: 3.3, unit: 'V' })).toEqual({ min: 3.3, max: 3.3, unit: 'V' });
  });

  it('extracts a range', () => {
    expect(numericBounds({ unit: 'Hz', min: 200000, max: 2200000, typ: 500000 })).toEqual({
      min: 200000,
      max: 2200000,
      unit: 'Hz',
    });
  });

  it.each([
    ['null', null],
    ['a boolean', true],
    ['a string', 'synchronous'],
    ['an object without a unit', { present: true, time: null }],
    ['an object with a unit but no numbers', { unit: 'V', value: '3' }],
  ])('returns undefined for %s', (_label, value) => {
    expect(numericBounds(value)).toBeUndefined();
  });
  it('indexes a one-sided bound on the end it states', () => {
    expect(numericBounds({ unit: 'Hz', max: 1_000_000 })).toEqual({ max: 1_000_000, unit: 'Hz' });
    expect(numericBounds({ unit: 'Hz', min: 100_000 })).toEqual({ min: 100_000, unit: 'Hz' });
  });
});
