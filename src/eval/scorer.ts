import {
  PARAMETER_KEYS,
  isBound,
  isQuantity,
  isRange,
  isSoftStart,
  type ParameterKey,
} from '../core/index.js';
import { parsePackage } from '../classify/index.js';
import { PARAMETER_POLICIES } from '../reconcile/index.js';
import type { ParameterSet, ParameterValue } from '../reconcile/types.js';
import { compareQuantities, type Tolerance } from '../units/index.js';
import type { GoldenPart } from './golden.js';

export const SCORES = ['correct', 'wrong', 'missing', 'extra', 'absent'] as const;
export type Score = (typeof SCORES)[number];

/** How the cited page compares with the page the value was read from. */
export const PAGE_SCORES = ['exact', 'within_one', 'wrong', 'none'] as const;
export type PageScore = (typeof PAGE_SCORES)[number];

export interface ParameterScore {
  readonly key: ParameterKey;
  readonly score: Score;
  readonly page: PageScore;
  /** Both values as they were read, for a person looking at a failure. */
  readonly expected: ParameterValue | undefined;
  readonly actual: ParameterValue | undefined;
}

export interface PartScore {
  readonly mpn: string;
  readonly parameters: readonly ParameterScore[];
  /** Values the golden set states that the extraction got right, over those it states. */
  readonly recall: number;
  /** Values the extraction states that are right, over those it states. */
  readonly precision: number;
  /** Correct values whose citation is the exact page, over correct values. */
  readonly provenanceAccuracy: number;
}

function sameQuantity(expected: unknown, actual: unknown, tolerance: Tolerance): boolean {
  if (!isQuantity(expected) || !isQuantity(actual)) {
    return false;
  }
  if (expected.unit !== actual.unit) {
    return false;
  }
  return (
    compareQuantities(
      { value: expected.value, unit: expected.unit } as never,
      { value: actual.value, unit: actual.unit } as never,
      tolerance,
    ).outcome === 'equal'
  );
}

interface Ends {
  readonly unit: string;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
}

function sameEnds(expected: Ends, actual: Ends, tolerance: Tolerance): boolean {
  const ends = ['min', 'max'] as const;
  return ends.every((end) => {
    const one = expected[end];
    const other = actual[end];
    if (one === undefined || other === undefined) {
      return one === other;
    }
    return sameQuantity(
      { value: one, unit: expected.unit },
      { value: other, unit: actual.unit },
      tolerance,
    );
  });
}

/**
 * Whether two packages are the same package.
 *
 * A package has one canonical form in this project — a family and a pin
 * count — and the text around it is prose: a datasheet writes `TSOT26` where
 * an ordering table writes `6-TSOT26`, and marking the extraction wrong for
 * that measures spelling. Reconciliation already compares packages this way,
 * and the scorer says "correct" about the same things reconciliation does.
 *
 * A text naming no family, or one outside the vocabulary, has no canonical
 * form to compare, so those fall back to the words themselves.
 */
function samePackage(expected: string, actual: string): boolean {
  const mine = parsePackage(expected);
  const theirs = parsePackage(actual);
  if (
    mine.family === null ||
    theirs.family === null ||
    mine.family === 'other' ||
    theirs.family === 'other'
  ) {
    return expected === actual;
  }
  if (mine.family !== theirs.family) {
    return false;
  }
  return mine.pins === null || theirs.pins === null || mine.pins === theirs.pins;
}

/**
 * Whether two parameter values say the same thing.
 *
 * Numbers are compared with the parameter's own tolerance, the same one
 * reconciliation uses, so "correct" means the same thing in both places, and
 * a package is compared by what it is rather than by how it is written.
 * Everything else is exact: an enum or a boolean is either what the datasheet
 * says or it is not.
 */
export function sameValue(
  key: ParameterKey,
  expected: ParameterValue,
  actual: ParameterValue,
): boolean {
  const { tolerance } = PARAMETER_POLICIES[key];
  if (expected === null || actual === null) {
    return expected === actual;
  }
  if (isSoftStart(expected) && isSoftStart(actual)) {
    if (expected.present !== actual.present) {
      return false;
    }
    if (expected.time === null || actual.time === null) {
      return expected.time === actual.time;
    }
    return sameQuantity(expected.time, actual.time, tolerance);
  }
  if (isQuantity(expected) || isQuantity(actual)) {
    return sameQuantity(expected, actual, tolerance);
  }
  if (key === 'package' && typeof expected === 'string' && typeof actual === 'string') {
    return samePackage(expected, actual);
  }
  if (isRange(expected) && isRange(actual)) {
    return sameEnds(expected, actual, tolerance);
  }
  if (isBound(expected) && isBound(actual)) {
    return sameEnds(expected, actual, tolerance);
  }
  return expected === actual;
}

function pageScore(expectedPage: number | undefined, actualPage: number | undefined): PageScore {
  if (actualPage === undefined || expectedPage === undefined) {
    return 'none';
  }
  if (actualPage === expectedPage) {
    return 'exact';
  }
  return Math.abs(actualPage - expectedPage) === 1 ? 'within_one' : 'wrong';
}

function citedPage(
  parameter: { provenance: { source: string; page?: number } } | undefined,
): number | undefined {
  return parameter?.provenance.source === 'datasheet' ? parameter.provenance.page : undefined;
}

function ratio(right: number, total: number): number {
  return total === 0 ? 1 : right / total;
}

/**
 * Scores one extracted parameter set against the golden reading of the same
 * part.
 *
 * `missing` is a value the golden set states and the extraction does not;
 * `extra` is one the extraction states where the golden set holds `null`,
 * which is the expensive mistake — a value invented where the datasheet says
 * nothing. `absent` is both agreeing there is nothing to state, and counts
 * for neither precision nor recall.
 */
export function scorePart(golden: GoldenPart, extracted: ParameterSet): PartScore {
  const parameters: ParameterScore[] = [];
  for (const key of PARAMETER_KEYS) {
    const expectedParameter = golden.parameters[key];
    const actualParameter = extracted[key];
    const expected = expectedParameter.value;
    const actual = actualParameter?.value;
    const page = pageScore(citedPage(expectedParameter), citedPage(actualParameter));

    let score: Score;
    if (actualParameter === undefined) {
      score = expected === null ? 'absent' : 'missing';
    } else if (expected === null && actual !== null) {
      score = 'extra';
    } else if (expected === null && actual === null) {
      score = 'absent';
    } else {
      score = sameValue(key, expected, actual as ParameterValue) ? 'correct' : 'wrong';
    }
    parameters.push({
      key,
      score,
      page,
      expected,
      actual,
    });
  }

  const correct = parameters.filter((one) => one.score === 'correct');
  const stated = parameters.filter((one) => one.score !== 'absent');
  const claimed = parameters.filter(
    (one) => one.score === 'correct' || one.score === 'wrong' || one.score === 'extra',
  );
  return {
    mpn: golden.mpn,
    parameters,
    recall: ratio(correct.length, stated.length),
    precision: ratio(correct.length, claimed.length),
    provenanceAccuracy: ratio(correct.filter((one) => one.page === 'exact').length, correct.length),
  };
}

export interface SetScore {
  readonly parts: readonly PartScore[];
  readonly recall: number;
  readonly precision: number;
  readonly provenanceAccuracy: number;
  /** How often a citation landed one page away, reported separately from exact. */
  readonly withinOnePage: number;
  /** Per parameter, how many parts got it right out of how many stated it. */
  readonly byParameter: Readonly<Record<ParameterKey, { correct: number; stated: number }>>;
}

/** Scores a whole run: every part, and the totals across them. */
export function scoreSet(scores: readonly PartScore[]): SetScore {
  const all = scores.flatMap((part) => part.parameters);
  const correct = all.filter((one) => one.score === 'correct');
  const stated = all.filter((one) => one.score !== 'absent');
  const claimed = all.filter(
    (one) => one.score === 'correct' || one.score === 'wrong' || one.score === 'extra',
  );
  const byParameter = Object.fromEntries(
    PARAMETER_KEYS.map((key) => {
      const forKey = all.filter((one) => one.key === key);
      return [
        key,
        {
          correct: forKey.filter((one) => one.score === 'correct').length,
          stated: forKey.filter((one) => one.score !== 'absent').length,
        },
      ];
    }),
  ) as Record<ParameterKey, { correct: number; stated: number }>;

  return {
    parts: scores,
    recall: ratio(correct.length, stated.length),
    precision: ratio(correct.length, claimed.length),
    provenanceAccuracy: ratio(correct.filter((one) => one.page === 'exact').length, correct.length),
    withinOnePage: ratio(correct.filter((one) => one.page === 'within_one').length, correct.length),
    byParameter,
  };
}
