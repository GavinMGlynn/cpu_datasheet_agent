import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { UNITS, type Unit } from '../core/quantity.js';
import { formatEngineering, formatQuantity, formatRange } from './format.js';
import { parseQuantity, parseRange } from './parse.js';

describe('formatQuantity', () => {
  it.each([
    [{ value: 3.3, unit: 'V' }, '3.3 V'],
    [{ value: 570000, unit: 'Hz' }, '570000 Hz'],
    [{ value: 0.00007, unit: 'A' }, '0.00007 A'],
    [{ value: 1.3e-7, unit: 's' }, '1.3e-7 s'],
    [{ value: 0.08, unit: 'Ohm' }, '0.08 Ω'],
    [{ value: -40, unit: 'degC' }, '-40 °C'],
    [{ value: 91, unit: 'percent' }, '91 %'],
    [{ value: 4, unit: 'count' }, '4'],
    [{ value: 1e21, unit: 'Hz' }, '1e+21 Hz'],
  ] as const)('formats %j as %s', (quantity, expected) => {
    expect(formatQuantity(quantity)).toBe(expected);
  });
});

describe('formatRange', () => {
  it('formats min, max, and an optional typical value', () => {
    expect(formatRange({ unit: 'Hz', min: 100000, max: 2200000 })).toBe('100000 ~ 2200000 Hz');
    expect(formatRange({ unit: 'Hz', min: 100000, max: 2200000, typ: 500000 })).toBe(
      '100000 ~ 2200000 Hz (typ 500000 Hz)',
    );
    expect(formatRange({ unit: 'count', min: 1, max: 4 })).toBe('1 ~ 4');
    expect(formatRange({ unit: 'count', min: 1, max: 4, typ: 2 })).toBe('1 ~ 4 (typ 2)');
  });
});

describe('formatEngineering', () => {
  it.each([
    [{ value: 570000, unit: 'Hz' }, '570 kHz'],
    [{ value: 0.00007, unit: 'A' }, '70 µA'],
    [{ value: 3.3, unit: 'V' }, '3.3 V'],
    [{ value: 1.3e-7, unit: 's' }, '130 ns'],
    [{ value: 0.08, unit: 'Ohm' }, '80 mΩ'],
    [{ value: 2.2e6, unit: 'Hz' }, '2.2 MHz'],
    [{ value: 2.5e12, unit: 'Hz' }, '2500 GHz'],
    [{ value: 1e-15, unit: 's' }, '0.001 ps'],
    [{ value: 0, unit: 'V' }, '0 V'],
    [{ value: -40, unit: 'degC' }, '-40 °C'],
    [{ value: 91.25, unit: 'percent' }, '91.25 %'],
    [{ value: 4, unit: 'count' }, '4'],
    [{ value: 3.14159, unit: 'V' }, '3.142 V'],
    [{ value: -0.0025, unit: 'V' }, '-2.5 mV'],
  ] as const)('formats %j as %s', (quantity, expected) => {
    expect(formatEngineering(quantity)).toBe(expected);
  });

  it('honours the number of significant digits', () => {
    expect(formatEngineering({ value: 3.14159, unit: 'V' }, 2)).toBe('3.1 V');
    expect(formatEngineering({ value: 123456, unit: 'Hz' }, 6)).toBe('123.456 kHz');
    expect(formatEngineering({ value: 12.3456, unit: 'percent' }, 2)).toBe('12 %');
  });
});

function magnitude(unit: Unit): fc.Arbitrary<number> {
  if (unit === 'degC') {
    return fc.double({ min: -273.15, max: 1000, noNaN: true, noDefaultInfinity: true });
  }
  if (unit === 'percent') {
    return fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true });
  }
  return fc.double({ min: 0, max: 1e30, noNaN: true, noDefaultInfinity: true });
}

describe('round trips', () => {
  it('parse(format(q)) reproduces every quantity exactly', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...UNITS),
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        (unit, seed) => {
          const value =
            unit === 'degC'
              ? Math.max(-273.15, Math.min(1000, seed))
              : unit === 'percent'
                ? Math.abs(seed) % 100
                : Math.abs(seed);
          const parsed = parseQuantity(formatQuantity({ value, unit }), unit);
          return parsed.value === value && parsed.unit === unit;
        },
      ),
      { numRuns: 500 },
    );
  });

  it('parse(format(range)) reproduces every range', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...UNITS),
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        (unit, a, b) => {
          const clamp = (x: number): number =>
            unit === 'degC'
              ? Math.max(-273.15, Math.min(1000, x))
              : unit === 'percent'
                ? Math.abs(x) % 100
                : Math.abs(x);
          const [min, max] = [clamp(a), clamp(b)].sort((x, y) => x - y) as [number, number];
          const parsed = parseRange(formatRange({ unit, min, max }), unit);
          return parsed.min === min && parsed.max === max && parsed.unit === unit;
        },
      ),
      { numRuns: 500 },
    );
  });

  it('accepts every generated magnitude for its unit', () => {
    for (const unit of UNITS) {
      fc.assert(
        fc.property(
          magnitude(unit),
          (value) => parseQuantity(formatQuantity({ value, unit }), unit).value === value,
        ),
        { numRuns: 50 },
      );
    }
  });
});
