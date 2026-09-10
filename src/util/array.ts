import { ChipAgentError } from '../errors.js';

export class ArrayIndexError extends ChipAgentError {}

/**
 * Reads an element the caller has already proved is present.
 *
 * `noUncheckedIndexedAccess` types every index as possibly undefined, which
 * would otherwise force an unreachable fallback at each use. This reports a
 * real error instead, so an off-by-one fails loudly rather than silently
 * substituting a default.
 */
export function elementAt<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw new ArrayIndexError(
      'ARRAY_INDEX_OUT_OF_RANGE',
      `index ${String(index)} is outside a length-${String(values.length)} array`,
      {
        details: { index, length: values.length },
      },
    );
  }
  return value;
}
