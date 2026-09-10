import { describe, expect, it } from 'vitest';

import { pageMetrics, splitCells } from './metrics.js';

describe('splitCells', () => {
  it('splits on runs of two or more spaces and on tabs', () => {
    expect(splitCells('Min   Typ   Max')).toEqual(['Min', 'Typ', 'Max']);
    expect(splitCells('a\tb\t\tc')).toEqual(['a', 'b', 'c']);
    expect(splitCells('one two')).toEqual(['one two']);
    expect(splitCells('   ')).toEqual([]);
    expect(splitCells('')).toEqual([]);
    expect(splitCells('  lead   trail  ')).toEqual(['lead', 'trail']);
  });
});

describe('pageMetrics', () => {
  it('counts lines, including empty ones', () => {
    const metrics = pageMetrics('a\n\nb\n');
    expect(metrics.lineCount).toBe(4);
    expect(metrics.nonEmptyLineCount).toBe(2);
  });

  it('reports zeroes for empty text', () => {
    expect(pageMetrics('')).toEqual({
      lineCount: 1,
      nonEmptyLineCount: 0,
      maxColumns: 0,
      medianColumns: 0,
      numericTokenCount: 0,
      orphanNumericLineCount: 0,
      orphanNumericRatio: 0,
      suspectTable: false,
    });
  });

  it('measures columns from space runs', () => {
    const metrics = pageMetrics(
      ['Parameter   Min   Typ   Max', 'VIN   3.5   12   28', 'prose line here'].join('\n'),
    );
    expect(metrics.maxColumns).toBe(4);
    expect(metrics.medianColumns).toBe(4);
  });

  it('takes the median of an even number of lines', () => {
    expect(pageMetrics(['a  b', 'a  b  c  d'].join('\n')).medianColumns).toBe(3);
  });

  it('counts numeric tokens including signs, exponents, and unit suffixes', () => {
    const metrics = pageMetrics('-40 +125 3.3V 570kHz 1.5e3 ±2% .8 0.08Ohm');
    expect(metrics.numericTokenCount).toBe(8);
  });

  it('does not count words or part numbers as numeric', () => {
    expect(pageMetrics('XYZ54331DR Tape and Reel').numericTokenCount).toBe(0);
  });

  it('counts lines of numbers with no label as orphans', () => {
    const metrics = pageMetrics(
      ['VIN   3.5   12   28', '0.784   0.800   0.816', '456   570   684'].join('\n'),
    );
    expect(metrics.orphanNumericLineCount).toBe(2);
    expect(metrics.orphanNumericRatio).toBeCloseTo(2 / 3, 10);
  });

  it('treats a unit suffix as part of the number, not a label', () => {
    expect(pageMetrics('3.5V   12V   28V').orphanNumericLineCount).toBe(1);
    expect(pageMetrics('3.5 V   12 V   28 V').orphanNumericLineCount).toBe(1);
  });

  it('flags a table that lost its labels', () => {
    const mangled = [
      '3.5   12.0   28.0',
      '0.784   0.800   0.816',
      '456   570   684',
      '0.06   0.08   0.11',
    ].join('\n');
    expect(pageMetrics(mangled).suspectTable).toBe(true);
  });

  it('flags a wide table even when rows keep their labels', () => {
    const wide = [
      'VIN   3.5   12.0   28.0   V',
      'VREF   0.784   0.800   0.816   V',
      'FSW   456   570   684   kHz',
    ].join('\n');
    const metrics = pageMetrics(wide);
    expect(metrics.medianColumns).toBe(5);
    expect(metrics.suspectTable).toBe(true);
  });

  it('does not flag prose', () => {
    const prose = [
      'The device operates from a 3.5 V to 28 V input.',
      'Output current is up to 3 A continuous.',
      'The switching frequency is fixed at 570 kHz.',
      'Soft start is internally fixed.',
    ].join('\n');
    expect(pageMetrics(prose).suspectTable).toBe(false);
  });

  it('does not flag a short page even when it is all numbers', () => {
    expect(pageMetrics('1   2\n3   4').suspectTable).toBe(false);
  });

  it('does not flag a long page with too few numbers', () => {
    const sparse = ['label one', 'label two', 'label three', '3.3', '5.0'].join('\n');
    expect(pageMetrics(sparse).suspectTable).toBe(false);
  });

  it('is stable for identical input', () => {
    const text = 'VIN   3.5   12   28\n0.7   0.8   0.9';
    expect(pageMetrics(text)).toEqual(pageMetrics(text));
  });
});
