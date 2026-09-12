// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  CATEGORICAL_DARK,
  CATEGORICAL_LIGHT,
  SEQUENTIAL,
  STATUS,
  categorical,
  rampColor,
  seriesColor,
  statusColor,
} from './palette.js';

/**
 * The palette was validated with the data-visualisation validator before any
 * chart was drawn; these tests pin the rules that come with it.
 */

describe('categorical slots', () => {
  it('hands out the slots in order', () => {
    expect(seriesColor(0)).toBe('#2a78d6');
    expect(seriesColor(1)).toBe('#eb6834');
    expect(seriesColor(0, 'dark')).toBe('#3987e5');
  });

  it('never invents a hue past the last slot', () => {
    expect(seriesColor(99)).toBe(CATEGORICAL_LIGHT[CATEGORICAL_LIGHT.length - 1]);
    expect(seriesColor(99, 'dark')).toBe(CATEGORICAL_DARK[CATEGORICAL_DARK.length - 1]);
  });

  it('keeps both modes the same length, since one is the other re-stepped', () => {
    expect(categorical('light')).toHaveLength(CATEGORICAL_DARK.length);
    expect(categorical('dark')).toStrictEqual(CATEGORICAL_DARK);
  });
});

describe('the sequential ramp', () => {
  it('goes light to dark with the magnitude', () => {
    expect(rampColor(0)).toBe(SEQUENTIAL[0]);
    expect(rampColor(1)).toBe(SEQUENTIAL[SEQUENTIAL.length - 1]);
    expect(rampColor(0.5)).toBe(SEQUENTIAL[6]);
  });

  it('treats nothing, and nonsense, as the lightest step', () => {
    expect(rampColor(-1)).toBe(SEQUENTIAL[0]);
    expect(rampColor(Number.NaN)).toBe(SEQUENTIAL[0]);
  });

  it('never runs off the end', () => {
    expect(rampColor(5)).toBe(SEQUENTIAL[SEQUENTIAL.length - 1]);
  });
});

describe('status colours', () => {
  it('are reserved for state', () => {
    expect(statusColor('good')).toBe(STATUS.good);
    expect(statusColor('critical')).toBe(STATUS.critical);
  });
});
