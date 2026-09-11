/** Parses JSON stored in a column. The result is validated by the caller's schema. */
export function parseJson(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  return parsed;
}

/** Bounds a parameter value can be filtered on: a quantity or a range with a unit. */
/**
 * The numeric extent of a value, for the columns a query filters on.
 *
 * One end may be absent: a datasheet that states "up to 1 MHz" gives an
 * upper end and nothing else, and inventing a lower one would make a filter
 * on it answer a question nobody asked.
 */
export interface NumericBounds {
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly unit: string;
}

export function numericBounds(value: unknown): NumericBounds | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.unit !== 'string') {
    return undefined;
  }
  if (typeof candidate.value === 'number') {
    return { min: candidate.value, max: candidate.value, unit: candidate.unit };
  }
  if (typeof candidate.min === 'number' && typeof candidate.max === 'number') {
    return { min: candidate.min, max: candidate.max, unit: candidate.unit };
  }
  // A one-sided bound ("up to 1 MHz") indexes on the end it states and leaves
  // the other null, so a filter on that end still finds it and a filter on
  // the end nobody stated does not pretend to.
  if (typeof candidate.max === 'number') {
    return { max: candidate.max, unit: candidate.unit };
  }
  if (typeof candidate.min === 'number') {
    return { min: candidate.min, unit: candidate.unit };
  }
  return undefined;
}
