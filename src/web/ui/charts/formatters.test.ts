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
  timeTick,
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

  describe('timeTick', () => {
    it('reads an hourly bucket as a clock time', () => {
      expect(timeTick('2026-09-11T14')).toBe('14:00');
      expect(timeTick('2026-09-11T00')).toBe('00:00');
    });

    it('reads a daily bucket as a day and a month', () => {
      expect(timeTick('2026-09-11')).toBe('11 Sep');
      expect(timeTick('2026-01-01')).toBe('1 Jan');
    });

    it('leaves a bucket it does not recognise exactly as it came', () => {
      // A week is labelled by its Monday, a month by its first — both parse as
      // days. Anything else is someone else's key, and guessing at it would be
      // worse than printing it.
      expect(timeTick('claude-opus-5')).toBe('claude-opus-5');
      expect(timeTick(42)).toBe('42');
      expect(timeTick('2026-13-40')).toBe('2026-13-40');
    });
  });
});
