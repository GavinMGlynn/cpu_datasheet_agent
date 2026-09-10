/** Parses JSON stored in a column. The result is validated by the caller's schema. */
export function parseJson(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  return parsed;
}

/** Bounds a parameter value can be filtered on: a quantity or a range with a unit. */
export interface NumericBounds {
  readonly min: number;
  readonly max: number;
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
  return undefined;
}
