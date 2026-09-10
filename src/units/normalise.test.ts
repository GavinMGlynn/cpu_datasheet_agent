import { describe, expect, it } from 'vitest';

import { expandShorthand, normaliseText, stripToleranceSign } from './normalise.js';

describe('normaliseText', () => {
  it('applies NFC so composed and decomposed forms agree', () => {
    expect(normaliseText('é')).toBe('é');
  });

  it('turns unicode minus into a hyphen and exotic spaces into plain spaces', () => {
    expect(normaliseText('−40 °C')).toBe('-40 °C');
    expect(normaliseText('3 3  V')).toBe('3 3 V');
  });

  it('collapses whitespace and trims', () => {
    expect(normaliseText('  3.3   V \t\n')).toBe('3.3 V');
  });

  it('joins a sign to its digits', () => {
    expect(normaliseText('- 40 C')).toBe('-40 C');
    expect(normaliseText('+ 125 C')).toBe('+125 C');
    expect(normaliseText('- .5 V')).toBe('-.5 V');
    expect(normaliseText('3 - 32 V')).toBe('3 -32 V');
  });

  it('removes thousands separators but leaves other commas', () => {
    expect(normaliseText('1,500 kHz')).toBe('1500 kHz');
    expect(normaliseText('1,234,567 Hz')).toBe('1234567 Hz');
    expect(normaliseText('3,3 V')).toBe('3,3 V');
    expect(normaliseText('1,23')).toBe('1,23');
  });

  it('joins split unit spellings', () => {
    expect(normaliseText('125 deg C')).toBe('125 degC');
    expect(normaliseText('125 ° C')).toBe('125 °C');
    expect(normaliseText('12 V DC')).toBe('12 Vdc');
    expect(normaliseText('3 A dc')).toBe('3 Adc');
  });

  it('is idempotent', () => {
    const once = normaliseText(' −40 ° C  to + 125 deg C ');
    expect(normaliseText(once)).toBe(once);
  });
});

describe('stripToleranceSign', () => {
  it.each(['±2%', '+/-2%', '+-2%', '± 2%'])('strips the marker from %s', (text) => {
    expect(stripToleranceSign(text)).toBe('2%');
  });

  it('leaves plain signs alone', () => {
    expect(stripToleranceSign('-40')).toBe('-40');
    expect(stripToleranceSign('+5')).toBe('+5');
  });
});

describe('expandShorthand', () => {
  it.each([
    ['3V3', '3.3V'],
    ['1v8', '1.8v'],
    ['4A7', '4.7A'],
    ['12V0', '12.0V'],
  ])('expands %s to %s', (input, expected) => {
    expect(expandShorthand(input)).toBe(expected);
  });

  it.each(['4K7', '3V', '3.3V', '3V3V', '3 V 3', 'V33'])('leaves %s alone', (input) => {
    expect(expandShorthand(input)).toBe(input);
  });
});
