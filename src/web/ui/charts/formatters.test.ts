// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  bucketLabel,
  bucketTooltip,
  countTooltip,
  moneyTick,
  pairTooltip,
  moneyTooltip,
  tickWith,
  tooltipWith,
} from './formatters.js';

describe('the callbacks a chart library makes', () => {
  it('formats money on an axis and in a tooltip', () => {
    expect(moneyTick(3.41)).toBe('$3.41');
    expect(moneyTick('nonsense')).toBe('—');
    expect(moneyTooltip(0.45, 'spent')).toStrictEqual(['$0.45', 'spent']);
    expect(moneyTooltip(undefined, 'spent')).toStrictEqual(['—', 'spent']);
  });

  it('formats with whatever the chart uses, and treats nonsense as nothing', () => {
    const format = (value: number): string => `${String(value)} calls`;
    expect(tooltipWith(format)(7)).toBe('7 calls');
    expect(tooltipWith(format)(null)).toBe('0 calls');
    expect(tickWith(format)(2)).toBe('2 calls');
    expect(tickWith(format)('x')).toBe('0 calls');
  });

  it('formats a tooltip by the axis the value belongs to', () => {
    const tooltip = pairTooltip(
      'output current',
      (value) => `${String(value)} A`,
      (value) => `$${value.toFixed(2)}`,
    );
    expect(tooltip(3, 'output current')).toStrictEqual(['3 A', 'output current']);
    expect(tooltip(1.42, 'each')).toStrictEqual(['$1.42', 'each']);
  });

  it('labels a count', () => {
    expect(countTooltip(3, 'parts')).toStrictEqual(['3', 'parts']);
    expect(bucketTooltip(3)).toStrictEqual(['3', 'parts']);
    expect(bucketLabel('10 V')).toBe('from 10 V');
  });
});
