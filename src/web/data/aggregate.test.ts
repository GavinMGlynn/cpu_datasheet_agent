import { describe, expect, it } from 'vitest';

import {
  bucketByTime,
  bucketKey,
  countBy,
  cumulative,
  groupBy,
  histogram,
  percentile,
  rate,
  summarise,
  sumBy,
  topN,
} from './aggregate.js';

interface Run {
  readonly mpn: string;
  readonly model: string;
  readonly costUsd: number;
  readonly at: string;
}

const runs: Run[] = [
  { mpn: 'TPS54331DR', model: 'claude-opus-5', costUsd: 3.41, at: '2026-09-11T09:53:48Z' },
  { mpn: 'AP62200WU-7', model: 'claude-opus-5', costUsd: 4.27, at: '2026-09-11T11:07:33Z' },
  { mpn: 'LM5164DDAR', model: 'claude-haiku-4-5', costUsd: 0.45, at: '2026-09-12T02:10:00Z' },
];

describe('grouping', () => {
  it('groups items, keeping the order they arrived in', () => {
    const groups = groupBy(runs, (run) => run.model);
    expect([...groups.keys()]).toStrictEqual(['claude-opus-5', 'claude-haiku-4-5']);
    expect(groups.get('claude-opus-5')).toHaveLength(2);
  });

  it('counts and sums', () => {
    expect([...countBy(runs, (run) => run.model)]).toStrictEqual([
      ['claude-opus-5', 2],
      ['claude-haiku-4-5', 1],
    ]);
    expect(sumBy(runs, (run) => run.costUsd)).toBeCloseTo(8.13, 10);
    expect(sumBy([], (value: number) => value)).toBe(0);
  });
});

describe('percentile and summarise', () => {
  it('interpolates between neighbours', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([10, 20], 0.9)).toBeCloseTo(19, 10);
  });

  it('clamps a fraction outside zero to one', () => {
    expect(percentile([1, 2, 3], -1)).toBe(1);
    expect(percentile([1, 2, 3], 5)).toBe(3);
  });

  it('has nothing to say about no values', () => {
    expect(percentile([], 0.5)).toBeUndefined();
    expect(summarise([])).toBeUndefined();
  });

  it('describes a distribution in one go', () => {
    const summary = summarise([4, 1, 3, 2]);
    expect(summary).toMatchObject({ count: 4, sum: 10, min: 1, max: 4, mean: 2.5, p50: 2.5 });
    expect(summary?.p90).toBeCloseTo(3.7, 10);
    expect(summary?.p99).toBeCloseTo(3.97, 10);
  });
});

describe('histogram', () => {
  it('puts values in equal-width buckets, the last one closed', () => {
    const buckets = histogram([0, 1, 2, 3, 4, 5], { buckets: 5 });
    expect(buckets).toHaveLength(5);
    expect(buckets.map((bucket) => bucket.count)).toStrictEqual([1, 1, 1, 1, 2]);
    expect(buckets[0]).toStrictEqual({ from: 0, to: 1, count: 1 });
  });

  it('defaults to ten buckets', () => {
    expect(histogram([0, 10])).toHaveLength(10);
  });

  it('makes one bucket when every value is the same', () => {
    expect(histogram([570, 570, 570])).toStrictEqual([{ from: 570, to: 570, count: 3 }]);
  });

  it('honours an explicit range and drops what falls outside it', () => {
    const buckets = histogram([1, 5, 9, 20], { buckets: 2, min: 0, max: 10 });
    expect(buckets.map((bucket) => bucket.count)).toStrictEqual([1, 2]);
  });

  it('has no buckets for no values, and never fewer than one', () => {
    expect(histogram([])).toStrictEqual([]);
    expect(histogram([1, 2], { buckets: 0 })).toHaveLength(1);
  });
});

describe('time bucketing', () => {
  it('labels each granularity the way an axis wants it', () => {
    expect(bucketKey('2026-09-11T09:53:48Z', 'hour')).toBe('2026-09-11T09:00');
    expect(bucketKey('2026-09-11T09:53:48Z', 'day')).toBe('2026-09-11');
    expect(bucketKey('2026-09-11T09:53:48Z', 'week')).toBe('2026-09-07');
    expect(bucketKey('2026-09-11T09:53:48Z', 'month')).toBe('2026-09');
  });

  it('labels a Sunday by the Monday that started its week', () => {
    expect(bucketKey('2026-09-13T00:00:00Z', 'week')).toBe('2026-09-07');
  });

  it('groups oldest first', () => {
    const series = bucketByTime(runs, (run) => run.at, 'day');
    expect(series.map((bucket) => bucket.key)).toStrictEqual(['2026-09-11', '2026-09-12']);
    expect(series[0]?.items).toHaveLength(2);
  });
});

describe('cumulative, topN and rate', () => {
  it('adds up as it goes', () => {
    expect(cumulative([1, 2, 3])).toStrictEqual([1, 3, 6]);
    expect(cumulative([])).toStrictEqual([]);
  });

  it('takes the largest few without disturbing the input', () => {
    const input = [...runs];
    expect(topN(input, (run) => run.costUsd, 2).map((run) => run.mpn)).toStrictEqual([
      'AP62200WU-7',
      'TPS54331DR',
    ]);
    expect(input[0]?.mpn).toBe('TPS54331DR');
    expect(topN(input, (run) => run.costUsd, -1)).toStrictEqual([]);
  });

  it('is zero rather than not-a-number when nothing happened', () => {
    expect(rate(0, 0)).toBe(0);
    expect(rate(3, 4)).toBe(0.75);
  });
});
