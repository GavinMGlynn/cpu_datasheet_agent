/**
 * Structural guards for parameter values.
 *
 * A parameter's value is a quantity, a range, a soft-start record, a boolean,
 * a string or null, and code that reads values generically — rendering them,
 * comparing them against a distributor's — has to tell which it is holding.
 * The guards are structural rather than schema parses because they run on
 * values that are already validated, and a parse per value per row is a cost
 * for nothing.
 */

export interface QuantityLike {
  readonly value: number;
  readonly unit: string;
}

export interface RangeLike {
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  readonly typ?: number | undefined;
}

export interface SoftStartLike {
  readonly present: boolean;
  readonly time: QuantityLike | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isQuantity(value: unknown): value is QuantityLike {
  return isObject(value) && typeof value.value === 'number' && typeof value.unit === 'string';
}

export function isRange(value: unknown): value is RangeLike {
  return (
    isObject(value) &&
    typeof value.unit === 'string' &&
    typeof value.min === 'number' &&
    typeof value.max === 'number'
  );
}

export function isSoftStart(value: unknown): value is SoftStartLike {
  return isObject(value) && typeof value.present === 'boolean' && 'time' in value;
}
