import { PARAMETER_KEYS, type ParameterKey } from '../core/index.js';
import type { LoadedGolden } from './load.js';

/** How many parts must state a parameter for a score on it to mean anything. */
export const MINIMUM_EXAMPLES = 3;

export interface HealthIssue {
  readonly kind: 'duplicate_part' | 'too_few_examples';
  readonly subject: string;
  readonly detail: string;
}

/**
 * What would make a score misleading.
 *
 * A duplicate part counts twice and quietly weights the average. A parameter
 * only one or two parts state is a coin toss: one lucky reading looks like a
 * capability and one unlucky one looks like a defect. Neither is a failure of
 * the extraction, which is why they are checked here rather than scored.
 */
export function checkGoldenHealth(golden: readonly LoadedGolden[]): readonly HealthIssue[] {
  const issues: HealthIssue[] = [];
  const seen = new Set<string>();
  for (const entry of golden) {
    if (seen.has(entry.part.mpn)) {
      issues.push({
        kind: 'duplicate_part',
        subject: entry.part.mpn,
        detail: `${entry.part.mpn} appears more than once, so it counts more than once`,
      });
    }
    seen.add(entry.part.mpn);
  }
  for (const key of PARAMETER_KEYS) {
    const stating = golden.filter((entry) => entry.part.parameters[key].value !== null).length;
    if (stating < MINIMUM_EXAMPLES) {
      issues.push({
        kind: 'too_few_examples',
        subject: key,
        detail: `only ${String(stating)} part(s) state ${key}; ${String(MINIMUM_EXAMPLES)} are needed for a score on it to mean anything`,
      });
    }
  }
  return issues;
}

/** The parameters the set covers, and how thinly. */
export function coverage(golden: readonly LoadedGolden[]): Readonly<Record<ParameterKey, number>> {
  return Object.fromEntries(
    PARAMETER_KEYS.map((key) => [
      key,
      golden.filter((entry) => entry.part.parameters[key].value !== null).length,
    ]),
  ) as Record<ParameterKey, number>;
}
