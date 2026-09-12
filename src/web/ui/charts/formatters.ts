import { usd } from '../lib/format.js';

/**
 * The functions the chart library calls back into.
 *
 * Exported rather than written inline because a library calls them only when
 * it has laid a chart out and a pointer is over it — so inline they would be
 * code nothing could test. Here they are ordinary functions with ordinary
 * tests, and the chart passes a reference.
 */

/** A tick on a money axis. Anything that is not a number is not a tick. */
export function moneyTick(value: unknown): string {
  return usd(typeof value === 'number' ? value : null);
}

/** A tooltip row on a money chart: the amount, and the series it belongs to. */
export function moneyTooltip(value: unknown, name: unknown): [string, string] {
  return [usd(typeof value === 'number' ? value : null), String(name)];
}

/** A tooltip row formatted by whatever the caller uses for that chart. */
export function tooltipWith(format: (value: number) => string): (value: unknown) => string {
  return (value) => format(typeof value === 'number' ? value : 0);
}

/** A tooltip row on a chart of counts. */
export function countTooltip(value: unknown, label: string): [string, string] {
  return [String(value), label];
}

/** The tooltip on a histogram: how many, of what. */
export function bucketTooltip(value: unknown): [string, string] {
  return countTooltip(value, 'parts');
}

/** The heading on a histogram tooltip: which band the pointer is over. */
export function bucketLabel(label: unknown): string {
  return `from ${String(label)}`;
}

/**
 * A tooltip row on a chart with two measures: the value formatted by whichever
 * axis it belongs to, and the axis's name.
 */
export function pairTooltip(
  xLabel: string,
  formatX: (value: number) => string,
  formatY: (value: number) => string,
): (value: unknown, name: unknown) => [string, string] {
  return (value, name) => [tickWith(name === xLabel ? formatX : formatY)(value), String(name)];
}

/** An axis tick formatted by the chart's own formatter. */
export function tickWith(format: (value: number) => string): (value: unknown) => string {
  return (value) => format(typeof value === 'number' ? value : 0);
}
