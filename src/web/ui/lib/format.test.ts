// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  bytes,
  count,
  duration,
  engineering,
  errorMessage,
  money,
  parameterValue,
  percent,
  shortId,
  unitLabel,
  usd,
  when,
} from './format.js';

describe('engineering', () => {
  it('gives a number the prefix that makes it readable', () => {
    expect(engineering(570_000, 'Hz')).toBe('570 kHz');
    expect(engineering(0.00007, 'A')).toBe('70 µA');
    expect(engineering(0.00000013, 's')).toBe('130 ns');
    expect(engineering(1_500_000_000, 'Hz')).toBe('1.5 GHz');
    expect(engineering(0.08, 'Ohm')).toBe('80 mΩ');
    expect(engineering(0.000000000005, 's')).toBe('5 ps');
  });

  it('leaves the units where a prefix would be wrong', () => {
    expect(engineering(-40, 'degC')).toBe('-40 °C');
    expect(engineering(91, 'percent')).toBe('91 %');
    expect(engineering(8, 'count')).toBe('8');
  });

  it('says zero plainly', () => {
    expect(engineering(0, 'V')).toBe('0 V');
  });

  it('keeps a value smaller than the smallest prefix out of scientific notation', () => {
    expect(engineering(1e-15, 's')).toBe('0.001 ps');
  });

  it('knows the symbols', () => {
    expect(unitLabel('Ohm')).toBe('Ω');
    expect(unitLabel('V')).toBe('V');
    expect(unitLabel('furlongs')).toBe('furlongs');
  });
});

describe('parameterValue', () => {
  it('renders every shape a stored value can take', () => {
    expect(parameterValue(null)).toBe('—');
    expect(parameterValue(undefined)).toBe('—');
    expect(parameterValue(true)).toBe('yes');
    expect(parameterValue(false)).toBe('no');
    expect(parameterValue('SOIC-8')).toBe('SOIC-8');
    expect(parameterValue(7)).toBe('7');
    expect(parameterValue({ value: 28, unit: 'V' })).toBe('28 V');
  });

  it('renders a range, with the typical value when there is one', () => {
    expect(parameterValue({ unit: 'Hz', min: 456_000, max: 684_000 })).toBe('456 kHz to 684 kHz');
    expect(parameterValue({ unit: 'Hz', min: 456_000, max: 684_000, typ: 570_000 })).toBe(
      '456 kHz to 684 kHz (typ 570 kHz)',
    );
  });

  it('renders a bound with only one end stated', () => {
    expect(parameterValue({ unit: 'Hz', max: 1_000_000 })).toBe('≤ 1 MHz');
    expect(parameterValue({ unit: 'A', min: 2 })).toBe('≥ 2 A');
  });

  it('renders a soft start, with and without a time', () => {
    expect(parameterValue({ present: true, time: { value: 0.001, unit: 's' } })).toBe('yes (1 ms)');
    expect(parameterValue({ present: true, time: null })).toBe('yes');
    expect(parameterValue({ present: false, time: null })).toBe('no');
  });

  it('falls back to JSON for anything it has never seen', () => {
    expect(parameterValue({ surprising: true })).toBe('{"surprising":true}');
  });
});

describe('errorMessage', () => {
  it('reads an error, and anything else that was thrown', () => {
    expect(errorMessage(new Error('the store said no'))).toBe('the store said no');
    expect(errorMessage('a string')).toBe('a string');
  });
});

describe('the small formatters', () => {
  it('formats money, dollars, percentages and counts', () => {
    expect(money(1.42)).toBe('AUD 1.42');
    expect(money(0.923)).toBe('AUD 0.923');
    expect(money(1.5, 'USD')).toBe('$1.50');
    expect(money(null)).toBe('—');
    expect(usd(3.41)).toBe('$3.41');
    expect(usd(undefined)).toBe('—');
    expect(percent(0.906)).toBe('90.6%');
    expect(percent(null)).toBe('—');
    expect(count(2505)).toBe('2,505');
    expect(count(undefined)).toBe('—');
  });

  it('formats durations at the scale they happened', () => {
    expect(duration(120)).toBe('120 ms');
    expect(duration(2100)).toBe('2.1 s');
    expect(duration(240_000)).toBe('4m 0s');
    expect(duration(null)).toBe('—');
  });

  it('formats times, sizes and identifiers', () => {
    expect(when('2026-09-11T09:53:48Z')).toBe('2026-09-11 09:53');
    expect(when('')).toBe('—');
    expect(when(undefined)).toBe('—');
    expect(when('not a date')).toBe('not a date');
    expect(bytes(512)).toBe('512 B');
    expect(bytes(7_300_000)).toBe('7.0 MB');
    expect(bytes(null)).toBe('—');
    expect(shortId('abcdef0123456789')).toBe('abcdef01');
    expect(shortId(undefined)).toBe('—');
    expect(shortId('')).toBe('—');
  });
});
