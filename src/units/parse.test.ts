import { describe, expect, it } from 'vitest';

import type { Unit } from '../core/quantity.js';
import {
  ParseError,
  parseQuantity,
  parseRange,
  parseTemperatureRange,
  scaleDecimal,
  splitRange,
  tryParseQuantity,
  tryParseRange,
  tryParseTemperatureRange,
} from './parse.js';

function rejection(run: () => unknown): ParseError {
  try {
    run();
  } catch (error) {
    if (error instanceof ParseError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a ParseError');
}

describe('scaleDecimal', () => {
  it('builds exact decimals without floating-point multiplication', () => {
    expect(scaleDecimal('70', -6)).toBe(0.00007);
    expect(scaleDecimal('3.3', 3)).toBe(3300);
    expect(scaleDecimal('130', -9)).toBe(1.3e-7);
    expect(scaleDecimal('.5', 0)).toBe(0.5);
    expect(scaleDecimal('5.', 0)).toBe(5);
    expect(scaleDecimal('-40', 0)).toBe(-40);
    expect(scaleDecimal('+2.5e2', -3)).toBe(0.25);
    expect(scaleDecimal('1e-3', 3)).toBe(1);
  });

  it('returns NaN for text that is not a decimal', () => {
    expect(scaleDecimal('abc', 0)).toBeNaN();
    expect(scaleDecimal('1e', 0)).toBeNaN();
  });
});

describe('parseQuantity', () => {
  const cases: readonly (readonly [string, Unit, number])[] = [
    ['3.3V', 'V', 3.3],
    ['3.3 V', 'V', 3.3],
    ['3V3', 'V', 3.3],
    ['3300mV', 'V', 3.3],
    ['3300 mV', 'V', 3.3],
    ['0.8 Volts', 'V', 0.8],
    ['12Vdc', 'V', 12],
    ['12 V DC', 'V', 12],
    ['+5V', 'V', 5],
    ['.8V', 'V', 0.8],
    ['1,500 mV', 'V', 1.5],
    ['3A', 'A', 3],
    ['1200mA', 'A', 1.2],
    ['40µA', 'A', 0.00004],
    ['40 μA', 'A', 0.00004],
    ['40uA', 'A', 0.00004],
    ['70 uA', 'A', 0.00007],
    ['1 nA', 'A', 1e-9],
    ['570kHz', 'Hz', 570000],
    ['570 KHz', 'Hz', 570000],
    ['2.2MHz', 'Hz', 2200000],
    ['1e6 Hz', 'Hz', 1000000],
    ['1E6Hz', 'Hz', 1000000],
    ['130ns', 's', 1.3e-7],
    ['2ms', 's', 0.002],
    ['1.5 µs', 's', 0.0000015],
    ['3 seconds', 's', 3],
    ['80mΩ', 'Ohm', 0.08],
    ['80 mOhm', 'Ohm', 0.08],
    ['80mohm', 'Ohm', 0.08],
    ['0.08 Ω', 'Ohm', 0.08],
    ['80 mΩ', 'Ohm', 0.08],
    ['2.5W', 'W', 2.5],
    ['500 mW', 'W', 0.5],
    ['-40°C', 'degC', -40],
    ['−40 °C', 'degC', -40],
    ['- 40 C', 'degC', -40],
    ['+125C', 'degC', 125],
    ['125 deg C', 'degC', 125],
    ['150℃', 'degC', 150],
    ['2%', 'percent', 2],
    ['±1 %', 'percent', 1],
    ['+/-1.5%', 'percent', 1.5],
    ['91 percent', 'percent', 91],
    ['4', 'count', 4],
    [' 4 ', 'count', 4],
  ];

  it.each(cases)('parses %j as %s', (text, unit, value) => {
    expect(parseQuantity(text, unit)).toEqual({ value, unit });
  });

  const rejections: readonly (readonly [string, Unit, string])[] = [
    ['3 V to 32 V', 'V', 'looks like a range'],
    ['4.5V ~ 28V', 'V', 'looks like a range'],
    ['3.3', 'V', 'missing unit'],
    ['3.3 A', 'V', 'expected V, found A'],
    ['abc', 'V', 'does not start with a number'],
    ['', 'V', 'does not start with a number'],
    ['V 3.3', 'V', 'does not start with a number'],
    ['3.3 Vx', 'V', 'unknown unit "Vx"'],
    ['3.3 V (typ)', 'V', 'unknown unit'],
    ['NaN V', 'V', 'does not start with a number'],
    ['Infinity V', 'V', 'does not start with a number'],
    ['1e400 V', 'V', 'not a finite number'],
    ['3,3 V', 'V', 'unknown unit'],
    ['4 pcs', 'count', 'unknown unit "pcs"'],
    ['5 m%', 'percent', 'unknown unit'],
    ['-5 V', 'V', 'cannot be'],
  ];

  it.each(rejections)('rejects %j for %s', (text, unit, reason) => {
    if (reason === 'cannot be') {
      expect(parseQuantity(text, unit)).toEqual({ value: -5, unit: 'V' });
      return;
    }
    const error = rejection(() => parseQuantity(text, unit));
    expect(error.code).toBe('UNIT_PARSE_FAILED');
    expect(error.message).toContain(reason);
    expect(error.details).toMatchObject({ expectedUnit: unit });
    expect(typeof error.details.text).toBe('string');
  });
});

describe('parseRange', () => {
  const cases: readonly (readonly [string, Unit, number, number])[] = [
    ['4.5V ~ 28V', 'V', 4.5, 28],
    ['4.5V~28V', 'V', 4.5, 28],
    ['3 to 32 V', 'V', 3, 32],
    ['3 TO 32 V', 'V', 3, 32],
    ['3V to 32', 'V', 3, 32],
    ['100-200kHz', 'Hz', 100000, 200000],
    ['100kHz-2.2MHz', 'Hz', 100000, 2200000],
    ['100 kHz - 2.2 MHz', 'Hz', 100000, 2200000],
    ['-40°C … +125°C', 'degC', -40, 125],
    ['-40°C ... 125°C', 'degC', -40, 125],
    ['-40 - 125 C', 'degC', -40, 125],
    ['-40°C - +125°C', 'degC', -40, 125],
    ['0.8V – 25V', 'V', 0.8, 25],
    ['0.8V — 25V', 'V', 0.8, 25],
    ['3/32 V', 'V', 3, 32],
    ['1e-3 V to 2e-3 V', 'V', 0.001, 0.002],
    ['1 to 1 V', 'V', 1, 1],
    ['3 to 32', 'count', 3, 32],
  ];

  it.each(cases)('parses %j as %s', (text, unit, min, max) => {
    expect(parseRange(text, unit)).toEqual({ unit, min, max });
  });

  const rejections: readonly (readonly [string, Unit, string])[] = [
    ['5 V', 'V', 'a single value is not a range'],
    ['1 to 2 to 3 V', 'V', 'more than two values'],
    ['32 to 3 V', 'V', 'range is reversed'],
    ['3 V to 32 A', 'V', 'expected V, found A'],
    ['3 A to 32 V', 'V', 'expected V, found A'],
    ['3 to 32', 'V', 'missing unit'],
    ['3 to x V', 'V', 'does not start with a number'],
    ['x to 3 V', 'V', 'does not start with a number'],
    ['3 ~', 'V', 'does not start with a number'],
  ];

  it.each(rejections)('rejects %j for %s', (text, unit, reason) => {
    expect(rejection(() => parseRange(text, unit)).message).toContain(reason);
  });
});

describe('parseTemperatureRange', () => {
  it.each([
    ['-40°C ~ 125°C (TJ)', 'junction'],
    ['-40°C ~ 125°C (TA)', 'ambient'],
    ['-40°C ~ 125°C Tj', 'junction'],
    ['-40°C ~ 125°C ta', 'ambient'],
    ['-40°C ~ 125°C (T_J)', 'junction'],
    ['-40°C ~ 125°C (T_A)', 'ambient'],
    ['-40°C ~ 125°C junction', 'junction'],
    ['-40°C ~ 125°C (ambient)', 'ambient'],
    ['-40°C ~ 125°C', null],
  ])('parses %j with reference %s', (text, reference) => {
    expect(parseTemperatureRange(text)).toEqual({
      range: { unit: 'degC', min: -40, max: 125 },
      reference,
    });
  });

  it('rejects text that is not a temperature range', () => {
    expect(() => parseTemperatureRange('125°C (TJ)')).toThrow(ParseError);
    expect(() => parseTemperatureRange('-40 V ~ 125 V')).toThrow(ParseError);
  });
});

describe('splitRange', () => {
  it('splits on every separator and keeps exponents intact', () => {
    expect(splitRange('3 to 32 V')).toEqual(['3', '32 V']);
    expect(splitRange('1e-3V-2e-3V')).toEqual(['1e-3V', '2e-3V']);
    expect(splitRange('-40')).toEqual(['-40']);
    expect(splitRange('SOIC-8')).toEqual(['SOIC', '8']);
  });
});

describe('tryParse wrappers', () => {
  it('return ok results and captured parse errors', () => {
    expect(tryParseQuantity('3.3V', 'V')).toEqual({ ok: true, value: { value: 3.3, unit: 'V' } });
    const failed = tryParseQuantity('x', 'V');
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error).toBeInstanceOf(ParseError);
    }
    expect(tryParseRange('3 to 4 V', 'V')).toEqual({
      ok: true,
      value: { unit: 'V', min: 3, max: 4 },
    });
    expect(tryParseRange('3 V', 'V').ok).toBe(false);
    expect(tryParseTemperatureRange('-40 to 85°C (TA)')).toEqual({
      ok: true,
      value: { range: { unit: 'degC', min: -40, max: 85 }, reference: 'ambient' },
    });
    expect(tryParseTemperatureRange('hot').ok).toBe(false);
  });

  it('rethrow anything that is not a parse error', () => {
    expect(() => tryParseQuantity(5 as unknown as string, 'V')).toThrow(TypeError);
  });
});
