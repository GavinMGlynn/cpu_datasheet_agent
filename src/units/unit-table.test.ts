import { describe, expect, it } from 'vitest';

import { UNITS } from '../core/quantity.js';
import {
  MAX_PREFIX_EXPONENT,
  MIN_PREFIX_EXPONENT,
  UNIT_SYMBOLS,
  UnitRangeError,
  resolveUnit,
  siPrefix,
} from './unit-table.js';

describe('resolveUnit', () => {
  it.each([
    ['V', 'V'],
    ['v', 'V'],
    ['Volts', 'V'],
    ['volt', 'V'],
    ['Vdc', 'V'],
    ['A', 'A'],
    ['amps', 'A'],
    ['Amp', 'A'],
    ['ampere', 'A'],
    ['Amperes', 'A'],
    ['Adc', 'A'],
    ['Hz', 'Hz'],
    ['hz', 'Hz'],
    ['Hertz', 'Hz'],
    ['s', 's'],
    ['sec', 's'],
    ['secs', 's'],
    ['second', 's'],
    ['seconds', 's'],
    ['Ohm', 'Ohm'],
    ['ohms', 'Ohm'],
    ['Ω', 'Ohm'],
    ['Ω', 'Ohm'],
    ['W', 'W'],
    ['watt', 'W'],
    ['Watts', 'W'],
    ['°C', 'degC'],
    ['℃', 'degC'],
    ['degC', 'degC'],
    ['DEGC', 'degC'],
    ['C', 'degC'],
    ['%', 'percent'],
    ['percent', 'percent'],
    ['pct', 'percent'],
  ])('resolves %s to %s with no prefix', (token, unit) => {
    expect(resolveUnit(token)).toEqual({ unit, exponent: 0 });
  });

  it.each([
    ['pF', null],
    ['ns', { unit: 's', exponent: -9 }],
    ['µA', { unit: 'A', exponent: -6 }],
    ['μA', { unit: 'A', exponent: -6 }],
    ['uA', { unit: 'A', exponent: -6 }],
    ['mV', { unit: 'V', exponent: -3 }],
    ['mΩ', { unit: 'Ohm', exponent: -3 }],
    ['mOhm', { unit: 'Ohm', exponent: -3 }],
    ['mohm', { unit: 'Ohm', exponent: -3 }],
    ['kHz', { unit: 'Hz', exponent: 3 }],
    ['KHz', { unit: 'Hz', exponent: 3 }],
    ['MHz', { unit: 'Hz', exponent: 6 }],
    ['MV', { unit: 'V', exponent: 6 }],
    ['GHz', { unit: 'Hz', exponent: 9 }],
    ['ps', { unit: 's', exponent: -12 }],
    ['mW', { unit: 'W', exponent: -3 }],
  ])('resolves %s', (token, expected) => {
    expect(resolveUnit(token)).toEqual(expected);
  });

  it.each(['', 'F', 'min', 'k', 'M', 'm%', 'k°C', 'mC', 'Vx', 'x', '3V', 'mmV'])(
    'rejects %j',
    (token) => {
      expect(resolveUnit(token)).toBeNull();
    },
  );
});

describe('UNIT_SYMBOLS', () => {
  it('has a symbol for every unit and none for count', () => {
    for (const unit of UNITS) {
      expect(typeof UNIT_SYMBOLS[unit]).toBe('string');
    }
    expect(UNIT_SYMBOLS.count).toBe('');
    expect(UNIT_SYMBOLS.Ohm).toBe('Ω');
    expect(UNIT_SYMBOLS.degC).toBe('°C');
  });
});

describe('siPrefix', () => {
  it.each([
    [-12, 'p'],
    [-9, 'n'],
    [-6, 'µ'],
    [-3, 'm'],
    [0, ''],
    [3, 'k'],
    [6, 'M'],
    [9, 'G'],
  ])('returns the prefix for 1e%d', (exponent, symbol) => {
    expect(siPrefix(exponent)).toBe(symbol);
  });

  it.each([1, -1, 2, 12, -15, 1.5])('throws for exponent %d', (exponent) => {
    expect(() => siPrefix(exponent)).toThrow(UnitRangeError);
  });

  it('reports the offending exponent', () => {
    try {
      siPrefix(15);
    } catch (error) {
      expect((error as UnitRangeError).code).toBe('UNIT_PREFIX_OUT_OF_RANGE');
      expect((error as UnitRangeError).details).toEqual({ exponent: 15 });
    }
  });

  it('covers the whole range the formatter clamps to', () => {
    expect(MIN_PREFIX_EXPONENT).toBe(-12);
    expect(MAX_PREFIX_EXPONENT).toBe(9);
  });
});
