import { PARAMETER_KEYS, type ParameterKey } from '../core/parameter-keys.js';
import type { Tolerance } from '../units/index.js';

/** How several observations of one parameter combine into one outcome. */
export type Corroboration = 'all' | 'any';

export interface ParameterPolicy {
  /** Allowance applied when the values are numbers. */
  readonly tolerance: Tolerance;
  /**
   * A conflict here always escalates and is never auto-resolved. These are
   * the ratings a wrong value destroys hardware over.
   */
  readonly safety: boolean;
  /**
   * `all`: every observation must agree, so one distributor disagreeing is a
   * conflict. `any`: one agreeing observation settles it, for a parameter
   * where several observations are different descriptions of one thing.
   */
  readonly corroboration: Corroboration;
  /** Why the tolerance is what it is. */
  readonly reason: string;
}

const EXACT: Tolerance = {};

function policy(
  tolerance: Tolerance,
  reason: string,
  options: { safety?: boolean; corroboration?: Corroboration } = {},
): ParameterPolicy {
  return {
    tolerance,
    reason,
    safety: options.safety ?? false,
    corroboration: options.corroboration ?? 'all',
  };
}

const NOT_COMPARED = policy(EXACT, 'no distributor publishes this, so no tolerance is in use');

/**
 * Per-parameter comparison policy.
 *
 * The tolerances are first estimates, set from what the recorded fixtures
 * show distributors doing rather than from a rule of thumb, and they are due
 * to be calibrated against the hand-characterised parts of Module 13. Each
 * one says why it is what it is, so a bad call is arguable from its reason.
 */
export const PARAMETER_POLICIES: Readonly<Record<ParameterKey, ParameterPolicy>> = Object.freeze({
  vinMin: policy(
    { relative: 0.02 },
    'distributors restate the recommended minimum, sometimes rounded (3.8 V for a 3.75 V part)',
  ),
  vinMax: policy({ relative: 0.02 }, 'as vinMin, and a wrong maximum destroys the part', {
    safety: true,
  }),
  vinAbsMax: policy(
    { relative: 0.02 },
    'neither distributor publishes an absolute maximum, so this waits on a source that does',
    { safety: true },
  ),
  voutMin: policy(
    { relative: 0.02 },
    'usually the feedback reference restated, which both sides agree on closely',
  ),
  voutMax: policy(
    { relative: 0.1 },
    'Digi-Key publishes a duty-cycle-limited maximum (17.28 V against an 18 V input) where a datasheet states the regulation range, so the two differ by several percent without disagreeing',
  ),
  voutFixed: policy({ relative: 0.01 }, 'a fixed output is an exact number on both sides'),
  ioutMax: policy(
    { relative: 0.02 },
    'both sides state the rated output current, and exceeding it is a thermal failure',
    { safety: true },
  ),
  switchingFrequency: policy(
    { relative: 0.05 },
    'datasheets state a typical switching frequency and distributors round it (570 kHz listed as 570 kHz, 1.1 MHz as 1.1 MHz, but 600 kHz parts appear as 0.6 MHz)',
  ),
  feedbackReference: policy({ relative: 0.02 }, 'an exact number both sides restate'),
  feedbackAccuracy: policy(
    { absolute: 0.5 },
    'stated in percent, and half a point of difference is rounding rather than disagreement',
  ),
  quiescentCurrent: policy(
    { relative: 0.25 },
    'Iq depends on the mode and conditions measured, and a distributor publishes one number for all of them',
  ),
  shutdownCurrent: policy({ relative: 0.25 }, 'as quiescent current'),
  topology: NOT_COMPARED,
  integration: NOT_COMPARED,
  softStart: NOT_COMPARED,
  enablePin: NOT_COMPARED,
  powerGoodPin: NOT_COMPARED,
  lightLoadMode: NOT_COMPARED,
  externalSync: NOT_COMPARED,
  operatingTempMin: policy(
    EXACT,
    'temperature grades are exact whole degrees, so any difference is a real one — most often junction against ambient',
    { safety: true },
  ),
  operatingTempMax: policy(EXACT, 'as operatingTempMin', { safety: true }),
  temperatureReference: NOT_COMPARED,
  package: policy(
    EXACT,
    'compared as a shape family and lead count, never as text; Digi-Key states the package twice and its own two fields disagree on 9 of 547 recorded parts, so one field agreeing settles it',
    { corroboration: 'any' },
  ),
  thermalPad: NOT_COMPARED,
  minOnTime: policy({ relative: 0.2 }, 'a typical figure that varies with conditions'),
  maxDutyCycle: policy({ absolute: 1 }, 'stated in percent and rounded'),
  efficiencyPeak: policy(
    { absolute: 2 },
    'read off a curve at one operating point, so two points of difference is not a disagreement',
  ),
  rdsOnHigh: policy(
    { relative: 0.2 },
    "a datasheet's typical and maximum on-resistance differ by more than a single published number can express",
    { safety: true },
  ),
  rdsOnLow: policy({ relative: 0.2 }, 'as rdsOnHigh', { safety: true }),
  aecQ100: NOT_COMPARED,
});

/** Parameters whose conflicts always escalate, in schema order. */
export const SAFETY_PARAMETERS: readonly ParameterKey[] = Object.freeze(
  PARAMETER_KEYS.filter((key) => PARAMETER_POLICIES[key].safety),
);
