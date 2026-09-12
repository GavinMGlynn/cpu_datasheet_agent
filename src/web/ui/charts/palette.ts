import { elementAt } from '../../../util/array.js';

/**
 * The chart palette, and the rules that come with it.
 *
 * Validated with the data-visualisation validator against both surfaces
 * before any chart was drawn:
 *
 *   light  #2a78d6 #eb6834 #1baf7a #eda100 — worst adjacent CVD ΔE 9.1,
 *          normal-vision ΔE 22.9, contrast WARN on aqua (2.74) and yellow
 *          (2.11), which is why every chart using those slots ships visible
 *          labels or a table view.
 *   dark   #3987e5 #d95926 #199e70 #c98500 — worst adjacent CVD ΔE 8.4,
 *          normal-vision ΔE 19.8, all four at or above 3:1.
 *
 * Slots are assigned in order and never cycled. A fifth series folds into
 * "other", or the chart becomes small multiples.
 */

export const CATEGORICAL_LIGHT: readonly string[] = Object.freeze([
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
]);

export const CATEGORICAL_DARK: readonly string[] = Object.freeze([
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
]);

/** Blue, light to dark. Magnitude in a grid: the heat map reads off this. */
export const SEQUENTIAL: readonly string[] = Object.freeze([
  '#cde2fb',
  '#b7d3f6',
  '#9ec5f4',
  '#86b6ef',
  '#6da7ec',
  '#5598e7',
  '#3987e5',
  '#2a78d6',
  '#256abf',
  '#1c5cab',
  '#184f95',
  '#104281',
  '#0d366b',
]);

/**
 * Reserved for state, never for a series, and never carrying meaning alone:
 * every use is paired with a word.
 */
export const STATUS: Readonly<Record<'good' | 'warning' | 'serious' | 'critical', string>> =
  Object.freeze({
    good: '#0ca30c',
    warning: '#fab219',
    serious: '#ec835a',
    critical: '#d03b3b',
  });

export type Mode = 'light' | 'dark';

export function categorical(mode: Mode): readonly string[] {
  return mode === 'dark' ? CATEGORICAL_DARK : CATEGORICAL_LIGHT;
}

/**
 * The slot for series `index`. Past the fourth it repeats the last slot, which
 * is a signal to fold the rest into "other" rather than a licence to cycle —
 * the callers that can have five series say so in their own way.
 */
export function seriesColor(index: number, mode: Mode = 'light'): string {
  const slots = categorical(mode);
  return elementAt(slots, Math.min(index, slots.length - 1));
}

/** A step of the sequential ramp for a fraction of the maximum, 0 to 1. */
export function rampColor(fraction: number): string {
  if (!Number.isFinite(fraction) || fraction <= 0) {
    return elementAt(SEQUENTIAL, 0);
  }
  return elementAt(
    SEQUENTIAL,
    Math.min(SEQUENTIAL.length - 1, Math.floor(fraction * SEQUENTIAL.length)),
  );
}

/** The status a number means, for the four states this project reports. */
export function statusColor(state: keyof typeof STATUS): string {
  return STATUS[state];
}
