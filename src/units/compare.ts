import type { Quantity } from '../core/quantity.js';
import { ChipAgentError } from '../errors.js';

export class UnitMismatchError extends ChipAgentError {}

export interface Tolerance {
  /** Fraction of the larger magnitude, for example 0.02 for two percent. */
  readonly relative?: number;
  /** Absolute allowance in the unit itself. */
  readonly absolute?: number;
}

export type ComparisonOutcome = 'equal' | 'a_greater' | 'b_greater';

export interface Comparison {
  readonly outcome: ComparisonOutcome;
  /** `b.value - a.value`. */
  readonly difference: number;
  /** `|difference|` over the larger magnitude, or 0 when both are zero. */
  readonly relativeDifference: number;
  /** The allowance that was applied. */
  readonly allowance: number;
}

/**
 * Compares two quantities of the same unit. They are `equal` when the
 * difference is within the larger of the absolute allowance and the relative
 * allowance times the larger magnitude. Throws `UnitMismatchError` when the
 * units differ; canonical quantities carry no prefixes, so no conversion is
 * needed beyond that check.
 */
export function compareQuantities(a: Quantity, b: Quantity, tolerance: Tolerance = {}): Comparison {
  if (a.unit !== b.unit) {
    throw new UnitMismatchError('UNIT_MISMATCH', `cannot compare ${a.unit} with ${b.unit}`, {
      details: { a: a.unit, b: b.unit },
    });
  }
  const difference = b.value - a.value;
  const larger = Math.max(Math.abs(a.value), Math.abs(b.value));
  const relativeDifference = larger === 0 ? 0 : Math.abs(difference) / larger;
  const allowance = Math.max(tolerance.absolute ?? 0, (tolerance.relative ?? 0) * larger);
  let outcome: ComparisonOutcome;
  if (Math.abs(difference) <= allowance) {
    outcome = 'equal';
  } else if (difference < 0) {
    outcome = 'a_greater';
  } else {
    outcome = 'b_greater';
  }
  return { outcome, difference, relativeDifference, allowance };
}
