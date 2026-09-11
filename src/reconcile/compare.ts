import type { ObservedValue } from '../core/observation.js';
import type { ParameterKey } from '../core/parameter-keys.js';
import type { Quantity, QuantityRange } from '../core/quantity.js';
import {
  isBound,
  isQuantity,
  isRange,
  isSoftStart,
  type BoundLike,
  type QuantityLike,
  type RangeLike,
  type SoftStartLike,
} from '../core/value-shapes.js';
import { parsePackage } from '../classify/index.js';
import {
  compareQuantities,
  formatEngineering,
  formatRange,
  type Tolerance,
} from '../units/index.js';
import { ReconcileError } from './errors.js';
import type { ParameterPolicy } from './policy.js';
import type { ParameterValue } from './types.js';

export type Verdict = 'agree' | 'conflict' | 'incomparable';

export interface Comparison {
  readonly verdict: Verdict;
  /** The rule that decided, recorded on a stored conflict. */
  readonly rule: string;
  /** Both readings, for an escalation question or a report row. */
  readonly detail: string;
}

export const COMPARISON_RULES = {
  quantity: 'quantity-tolerance.v1',
  bound: 'bound.v1',
  range: 'range.v1',
  enum: 'enum.v1',
  boolean: 'boolean.v1',
  softStart: 'soft-start.v1',
  outputType: 'output-type.v1',
  package: 'package-shape.v1',
} as const;

function mismatch(key: ParameterKey, extracted: ParameterValue, observed: ObservedValue): never {
  throw new ReconcileError(
    'RECONCILE_SHAPE_MISMATCH',
    `cannot compare ${key}: a ${observed.kind} observation against ${describeExtracted(extracted)}`,
    { details: { key, kind: observed.kind, extracted, observed } },
  );
}

function quantityText(quantity: QuantityLike): string {
  return formatEngineering(quantity as Quantity);
}

function rangeText(range: RangeLike): string {
  return formatRange(range as QuantityRange);
}

/** How a distributor stated it, as a person would read it back. */
export function describeObserved(observed: ObservedValue): string {
  switch (observed.kind) {
    case 'quantity':
      return quantityText(observed.value);
    case 'max':
      return `at most ${quantityText(observed.value)}`;
    case 'min':
      return `at least ${quantityText(observed.value)}`;
    case 'range':
      return rangeText(observed.value);
    case 'boolean':
      return observed.value ? 'yes' : 'no';
    case 'enum':
    case 'text':
      return observed.value;
  }
}

/** The stored value, as a person would read it back. */
export function describeExtracted(value: ParameterValue): string {
  if (value === null) {
    return 'not stated';
  }
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (isSoftStart(value)) {
    return softStartText(value);
  }
  if (isQuantity(value)) {
    return quantityText(value);
  }
  if (isRange(value)) {
    return rangeText(value);
  }
  return boundText(value);
}

/** A stated end, read as the limit it is rather than as a measurement. */
function boundText(bound: BoundLike): string {
  const { unit } = bound;
  return bound.max === undefined
    ? `at least ${quantityText({ value: bound.min, unit })}`
    : `at most ${quantityText({ value: bound.max, unit })}`;
}

function softStartText(value: SoftStartLike): string {
  if (!value.present) {
    return 'no';
  }
  return value.time === null ? 'yes' : `yes, ${quantityText(value.time)}`;
}

function decide(agrees: boolean, rule: string, extracted: string, observed: string): Comparison {
  return {
    verdict: agrees ? 'agree' : 'conflict',
    rule,
    detail: `${extracted} against ${observed}`,
  };
}

function equal(a: QuantityLike, b: QuantityLike, tolerance: Tolerance): boolean {
  return compareQuantities(a as Quantity, b as Quantity, tolerance).outcome === 'equal';
}

/** True when `value` is at most `bound`, within the allowance. */
function atMost(value: QuantityLike, bound: QuantityLike, tolerance: Tolerance): boolean {
  return compareQuantities(value as Quantity, bound as Quantity, tolerance).outcome !== 'a_greater';
}

/** True when `value` is at least `bound`, within the allowance. */
function atLeast(value: QuantityLike, bound: QuantityLike, tolerance: Tolerance): boolean {
  return compareQuantities(value as Quantity, bound as Quantity, tolerance).outcome !== 'b_greater';
}

function within(value: QuantityLike, range: RangeLike, tolerance: Tolerance): boolean {
  const unit = range.unit;
  return (
    atLeast(value, { value: range.min, unit }, tolerance) &&
    atMost(value, { value: range.max, unit }, tolerance)
  );
}

function ends(range: RangeLike): { readonly min: QuantityLike; readonly max: QuantityLike } {
  return {
    min: { value: range.min, unit: range.unit },
    max: { value: range.max, unit: range.unit },
  };
}

/**
 * A number or a range against a distributor's number, bound or range.
 *
 * A bound (`Up to 1MHz`) agrees with anything on the right side of it: it
 * states a limit, not a value, so agreeing means not exceeding it. A range
 * against a single value is containment in whichever direction the two sit,
 * because a datasheet stating an adjustable range and a distributor stating
 * one frequency inside it are not in disagreement.
 */
function numeric(
  key: ParameterKey,
  extracted: QuantityLike | RangeLike,
  observed: ObservedValue,
  tolerance: Tolerance,
): Comparison {
  const left = describeExtracted(extracted as ParameterValue);
  const right = describeObserved(observed);
  const asQuantity = isQuantity(extracted) ? extracted : null;
  switch (observed.kind) {
    case 'quantity':
      return asQuantity === null
        ? decide(
            within(observed.value, extracted as RangeLike, tolerance),
            COMPARISON_RULES.range,
            left,
            right,
          )
        : decide(
            equal(asQuantity, observed.value, tolerance),
            COMPARISON_RULES.quantity,
            left,
            right,
          );
    case 'max':
      return decide(
        atMost(asQuantity ?? ends(extracted as RangeLike).max, observed.value, tolerance),
        COMPARISON_RULES.bound,
        left,
        right,
      );
    case 'min':
      return decide(
        atLeast(asQuantity ?? ends(extracted as RangeLike).min, observed.value, tolerance),
        COMPARISON_RULES.bound,
        left,
        right,
      );
    case 'range': {
      if (asQuantity !== null) {
        return decide(
          within(asQuantity, observed.value, tolerance),
          COMPARISON_RULES.range,
          left,
          right,
        );
      }
      const mine = ends(extracted as RangeLike);
      const theirs = ends(observed.value);
      return decide(
        equal(mine.min, theirs.min, tolerance) && equal(mine.max, theirs.max, tolerance),
        COMPARISON_RULES.range,
        left,
        right,
      );
    }
    case 'enum':
    case 'boolean':
    case 'text':
      return mismatch(key, extracted as ParameterValue, observed);
  }
}

/**
 * A stored limit against what a distributor states.
 *
 * A limit can be contradicted but not confirmed: "up to 1 MHz" and a listed
 * 570 kHz are both true of the same part, so there is nothing to agree about.
 * A value beyond the limit is a real disagreement, and a limit against the
 * same limit is the one case that does corroborate.
 */
function boundComparison(
  extracted: BoundLike,
  observed: ObservedValue,
  tolerance: Tolerance,
): Comparison {
  const left = describeExtracted(extracted as ParameterValue);
  const right = describeObserved(observed);
  const { unit } = extracted;
  const limit =
    extracted.max === undefined ? { value: extracted.min, unit } : { value: extracted.max, unit };
  const upper = extracted.max !== undefined;
  if ((observed.kind === 'max' && upper) || (observed.kind === 'min' && !upper)) {
    return decide(equal(limit, observed.value, tolerance), COMPARISON_RULES.bound, left, right);
  }
  const stated =
    observed.kind === 'quantity' || observed.kind === 'max' || observed.kind === 'min'
      ? observed.value
      : observed.kind === 'range'
        ? { value: upper ? observed.value.max : observed.value.min, unit: observed.value.unit }
        : null;
  if (stated === null) {
    return {
      verdict: 'incomparable',
      rule: COMPARISON_RULES.bound,
      detail: `${left} against ${right}`,
    };
  }
  const within = upper ? atMost(stated, limit, tolerance) : atLeast(stated, limit, tolerance);
  return within
    ? { verdict: 'incomparable', rule: COMPARISON_RULES.bound, detail: `${left} against ${right}` }
    : { verdict: 'conflict', rule: COMPARISON_RULES.bound, detail: `${left} against ${right}` };
}

/**
 * A package against a distributor's package text, compared as a shape family
 * and a lead count rather than as words.
 *
 * `8-PowerSOIC (0.154", 3.90mm Width)` and `8-SOIC PowerPAD (DDA)` are the
 * same package written two ways, so text equality would report a conflict on
 * nearly every part. A text naming no family, or a family outside the
 * vocabulary on either side, is left incomparable rather than matched to
 * another unknown.
 */
function packageShape(
  key: ParameterKey,
  extracted: ParameterValue,
  observed: ObservedValue,
): Comparison {
  if (observed.kind !== 'text' || typeof extracted !== 'string') {
    return mismatch(key, extracted, observed);
  }
  const mine = parsePackage(extracted);
  const theirs = parsePackage(observed.value);
  const detail = `${extracted} against ${observed.value}`;
  if (
    mine.family === null ||
    theirs.family === null ||
    mine.family === 'other' ||
    theirs.family === 'other'
  ) {
    return { verdict: 'incomparable', rule: COMPARISON_RULES.package, detail };
  }
  if (mine.family !== theirs.family) {
    return { verdict: 'conflict', rule: COMPARISON_RULES.package, detail };
  }
  const pinsDiffer = mine.pins !== null && theirs.pins !== null && mine.pins !== theirs.pins;
  return {
    verdict: pinsDiffer ? 'conflict' : 'agree',
    rule: COMPARISON_RULES.package,
    detail,
  };
}

/**
 * A fixed output voltage against what a distributor says about output type.
 *
 * `null` is the schema's statement that the part is adjustable, so it agrees
 * with `Adjustable` and disagrees with a listed fixed voltage.
 */
function outputType(
  key: ParameterKey,
  extracted: ParameterValue,
  observed: ObservedValue,
  policy: ParameterPolicy,
): Comparison {
  const left = describeExtracted(extracted);
  const fixed = isQuantity(extracted) ? extracted : null;
  if (observed.kind === 'enum') {
    const right = observed.value;
    if (right !== 'fixed' && right !== 'adjustable') {
      return mismatch(key, extracted, observed);
    }
    return decide(
      (right === 'fixed') === (fixed !== null),
      COMPARISON_RULES.outputType,
      left,
      right,
    );
  }
  if (observed.kind === 'quantity') {
    const right = describeObserved(observed);
    return fixed === null
      ? decide(false, COMPARISON_RULES.outputType, left, right)
      : decide(
          equal(fixed, observed.value, policy.tolerance),
          COMPARISON_RULES.quantity,
          left,
          right,
        );
  }
  return mismatch(key, extracted, observed);
}

/**
 * Compares one distributor observation with the value a parameter holds.
 *
 * Throws {@link ReconcileError} `RECONCILE_SHAPE_MISMATCH` when the two cannot
 * be compared at all, which means the mapping table produced a fact of the
 * wrong kind for the parameter rather than that the part is unusual.
 */
export function compareObservation(
  key: ParameterKey,
  extracted: ParameterValue,
  observed: ObservedValue,
  policy: ParameterPolicy,
): Comparison {
  if (key === 'voutFixed') {
    return outputType(key, extracted, observed, policy);
  }
  if (key === 'package') {
    return packageShape(key, extracted, observed);
  }
  if (isSoftStart(extracted)) {
    return observed.kind === 'boolean'
      ? decide(
          extracted.present === observed.value,
          COMPARISON_RULES.softStart,
          softStartText(extracted),
          describeObserved(observed),
        )
      : mismatch(key, extracted, observed);
  }
  if (typeof extracted === 'boolean') {
    return observed.kind === 'boolean'
      ? decide(
          extracted === observed.value,
          COMPARISON_RULES.boolean,
          describeExtracted(extracted),
          describeObserved(observed),
        )
      : mismatch(key, extracted, observed);
  }
  if (typeof extracted === 'string') {
    return observed.kind === 'enum'
      ? decide(
          extracted === observed.value,
          COMPARISON_RULES.enum,
          extracted,
          describeObserved(observed),
        )
      : mismatch(key, extracted, observed);
  }
  if (isQuantity(extracted) || isRange(extracted)) {
    return numeric(key, extracted, observed, policy.tolerance);
  }
  if (isBound(extracted)) {
    return boundComparison(extracted, observed, policy.tolerance);
  }
  return mismatch(key, extracted, observed);
}
