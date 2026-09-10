import { describe, expect, it } from 'vitest';

import { UnitMismatchError, compareQuantities } from './compare.js';

const v = (value: number) => ({ value, unit: 'V' as const });

describe('compareQuantities', () => {
  it('is exact by default', () => {
    expect(compareQuantities(v(28), v(28))).toEqual({
      outcome: 'equal',
      difference: 0,
      relativeDifference: 0,
      allowance: 0,
    });
    expect(compareQuantities(v(28), v(28.000001)).outcome).toBe('b_greater');
    expect(compareQuantities(v(28.000001), v(28)).outcome).toBe('a_greater');
  });

  it('treats differences within the absolute allowance as equal', () => {
    expect(compareQuantities(v(28), v(28.4), { absolute: 0.5 }).outcome).toBe('equal');
    expect(compareQuantities(v(28), v(28.6), { absolute: 0.5 }).outcome).toBe('b_greater');
    expect(compareQuantities(v(28), v(27.5), { absolute: 0.5 }).outcome).toBe('equal');
  });

  it('treats differences within the relative allowance as equal, scaled by the larger magnitude', () => {
    const result = compareQuantities(v(100), v(102), { relative: 0.02 });
    expect(result).toEqual({
      outcome: 'equal',
      difference: 2,
      relativeDifference: 2 / 102,
      allowance: 2.04,
    });
    expect(compareQuantities(v(100), v(103), { relative: 0.02 }).outcome).toBe('b_greater');
  });

  it('uses the larger of the two allowances', () => {
    expect(compareQuantities(v(1), v(1.4), { absolute: 0.5, relative: 0.01 }).allowance).toBe(0.5);
    expect(
      compareQuantities(v(1000), v(1004), { absolute: 0.5, relative: 0.01 }).allowance,
    ).toBeCloseTo(10.04, 10);
  });

  it('reports a zero relative difference when both values are zero', () => {
    expect(compareQuantities(v(0), v(0))).toEqual({
      outcome: 'equal',
      difference: 0,
      relativeDifference: 0,
      allowance: 0,
    });
  });

  it('handles negative temperatures by magnitude', () => {
    const c = (value: number) => ({ value, unit: 'degC' as const });
    expect(compareQuantities(c(-40), c(-40.5), { relative: 0.02 }).outcome).toBe('equal');
    expect(compareQuantities(c(-40), c(-45), { relative: 0.02 }).outcome).toBe('a_greater');
  });

  it('refuses to compare different units', () => {
    expect(() => compareQuantities(v(1), { value: 1, unit: 'A' })).toThrow(UnitMismatchError);
    try {
      compareQuantities(v(1), { value: 1, unit: 'A' });
    } catch (error) {
      expect((error as UnitMismatchError).code).toBe('UNIT_MISMATCH');
      expect((error as UnitMismatchError).details).toEqual({ a: 'V', b: 'A' });
    }
  });
});
