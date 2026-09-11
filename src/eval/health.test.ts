import { describe, expect, it } from 'vitest';

import { PARAMETER_KEYS } from '../core/index.js';
import { MINIMUM_EXAMPLES, checkGoldenHealth, coverage } from './health.js';
import { loadGoldenSet, type LoadedGolden } from './load.js';

const golden = loadGoldenSet();

/**
 * The same part with `vinMax` stating nothing.
 *
 * The schema does not allow that — a buck regulator has an input maximum —
 * which is the point: the health check is about what a set can measure, not
 * about what a part can be, so the test builds a set the schema would refuse.
 */
function withoutVinMax(entry: LoadedGolden): LoadedGolden {
  const parameters = { ...entry.part.parameters } as Record<string, unknown>;
  parameters.vinMax = { ...entry.part.parameters.vinMax, value: null };
  return { ...entry, part: { ...entry.part, parameters } as LoadedGolden['part'] };
}

describe('checkGoldenHealth', () => {
  it('finds nothing wrong with the set as it stands', () => {
    expect(checkGoldenHealth(golden)).toEqual([]);
  });

  it('catches a part counted twice', () => {
    const first = golden[0];
    if (first === undefined) {
      throw new Error('the golden set is empty');
    }

    const issues = checkGoldenHealth([...golden, first]);

    expect(issues).toContainEqual(
      expect.objectContaining({ kind: 'duplicate_part', subject: first.part.mpn }),
    );
  });

  it('catches a parameter too few parts state to measure', () => {
    const thin = golden.map(withoutVinMax);

    const issues = checkGoldenHealth(thin);

    expect(issues).toContainEqual(
      expect.objectContaining({ kind: 'too_few_examples', subject: 'vinMax' }),
    );
    expect(issues[0]?.detail).toContain(`${String(MINIMUM_EXAMPLES)} are needed`);
  });
});

describe('coverage', () => {
  it('counts the parts stating each parameter, every parameter listed', () => {
    const counts = coverage(golden);

    expect(Object.keys(counts).sort()).toEqual([...PARAMETER_KEYS].sort());
    expect(counts.vinMax).toBe(golden.length);
    expect(Object.values(counts).every((count) => count >= MINIMUM_EXAMPLES)).toBe(true);
  });
});
