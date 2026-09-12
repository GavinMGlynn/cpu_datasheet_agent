import { elementAt } from '../../util/array.js';
import { required } from '../../util/present.js';

/**
 * The arithmetic every view shares.
 *
 * Pure functions over arrays, total on empty input: a page that asks for the
 * median of no runs gets `undefined`, never a crash and never a zero
 * pretending to be a measurement.
 */

export function groupBy<T, K extends string>(
  items: Iterable<T>,
  key: (item: T) => K,
): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = groups.get(k);
    if (bucket === undefined) {
      groups.set(k, [item]);
      continue;
    }
    bucket.push(item);
  }
  return groups;
}

export function countBy<T>(items: Iterable<T>, key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

export function sumBy<T>(items: Iterable<T>, value: (item: T) => number): number {
  let total = 0;
  for (const item of items) {
    total += value(item);
  }
  return total;
}

/**
 * The value at `fraction` through the sorted values, interpolating between
 * neighbours. `p90` of six runs is a real number between two of them rather
 * than whichever one happens to land on the index.
 */
export function percentile(values: readonly number[], fraction: number): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * Math.min(Math.max(fraction, 0), 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = elementAt(sorted, lower);
  const high = elementAt(sorted, upper);
  return low + (high - low) * (position - lower);
}

export interface Summary {
  readonly count: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly p50: number;
  readonly p90: number;
  readonly p99: number;
}

/** Every number a distribution view needs, in one pass of sorting. */
export function summarise(values: readonly number[]): Summary | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    sum,
    min: elementAt(sorted, 0),
    max: elementAt(sorted, sorted.length - 1),
    mean: sum / sorted.length,
    p50: required(percentile(sorted, 0.5), 'the median'),
    p90: required(percentile(sorted, 0.9), 'the 90th percentile'),
    p99: required(percentile(sorted, 0.99), 'the 99th percentile'),
  };
}

export interface Bucket {
  readonly from: number;
  readonly to: number;
  readonly count: number;
}

export interface HistogramOptions {
  readonly buckets?: number;
  readonly min?: number;
  readonly max?: number;
}

/**
 * Equal-width buckets over the range. A distribution where every value is the
 * same becomes one bucket of width zero rather than an infinite loop, which
 * is the case that happens the moment you chart a parameter every part shares.
 */
export function histogram(values: readonly number[], options: HistogramOptions = {}): Bucket[] {
  if (values.length === 0) {
    return [];
  }
  const min = options.min ?? Math.min(...values);
  const max = options.max ?? Math.max(...values);
  if (min === max) {
    return [{ from: min, to: max, count: values.filter((value) => value === min).length }];
  }
  const count = Math.max(1, Math.floor(options.buckets ?? 10));
  const width = (max - min) / count;
  const buckets: Bucket[] = Array.from({ length: count }, (_unused, index) => ({
    from: min + width * index,
    to: min + width * (index + 1),
    count: 0,
  }));
  const counts = new Array<number>(count).fill(0);
  for (const value of values) {
    if (value < min || value > max) {
      continue;
    }
    const index = Math.min(count - 1, Math.floor((value - min) / width));
    counts[index] = elementAt(counts, index) + 1;
  }
  return buckets.map((bucket, index) => ({ ...bucket, count: elementAt(counts, index) }));
}

export const GRANULARITIES = ['hour', 'day', 'week', 'month'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

/**
 * The bucket an instant falls in, as the ISO prefix that names it. A week is
 * labelled by the Monday that starts it, which is what a chart axis wants.
 */
export function bucketKey(iso: string, granularity: Granularity): string {
  const date = new Date(iso);
  switch (granularity) {
    case 'hour':
      return `${iso.slice(0, 13)}:00`;
    case 'day':
      return iso.slice(0, 10);
    case 'week': {
      const monday = new Date(date);
      const weekday = (monday.getUTCDay() + 6) % 7;
      monday.setUTCDate(monday.getUTCDate() - weekday);
      return monday.toISOString().slice(0, 10);
    }
    case 'month':
      return iso.slice(0, 7);
  }
}

export interface Series<T> {
  readonly key: string;
  readonly items: readonly T[];
}

/** Groups by time bucket, oldest first, with no gaps filled in. */
export function bucketByTime<T>(
  items: Iterable<T>,
  at: (item: T) => string,
  granularity: Granularity,
): Series<T>[] {
  const groups = groupBy(items, (item) => bucketKey(at(item), granularity));
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, bucketItems]) => ({ key, items: bucketItems }));
}

/** Running total over an ordered series, for "spent so far" charts. */
export function cumulative(values: readonly number[]): number[] {
  let total = 0;
  return values.map((value) => {
    total += value;
    return total;
  });
}

export function topN<T>(items: readonly T[], value: (item: T) => number, n: number): T[] {
  return [...items].sort((a, b) => value(b) - value(a)).slice(0, Math.max(0, n));
}

/** A proportion that is 0 rather than NaN when nothing happened. */
export function rate(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}
