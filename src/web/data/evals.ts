import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type { ParameterKey } from '../../core/parameter-keys.js';
import { compareReports, type Comparison } from '../../eval/compare.js';
import { checkGoldenHealth, coverage, type HealthIssue } from '../../eval/health.js';
import { loadGoldenSet, type LoadedGolden } from '../../eval/load.js';
import { EvalReport, REPORT_FILE, RESULTS_DIR, SUMMARY_FILE } from '../../eval/report.js';
import { parseOrThrow } from '../../core/validation-error.js';
import { rate } from './aggregate.js';
import { WebError } from '../server/errors.js';

/**
 * The evaluation results on disk.
 *
 * One directory per run, named for when it started, the prompt version and
 * the model. The site reads them rather than the harness's memory, so a
 * result from a week ago is as available as this morning's.
 */

export interface EvalListing {
  readonly id: string;
  readonly promptVersion: string;
  readonly model: string;
  readonly startedAt: string;
  readonly parts: number;
  readonly recall: number;
  readonly precision: number;
  readonly provenanceAccuracy: number;
  readonly withinOnePage: number;
  readonly costUsd: number;
  readonly turns: number;
  readonly starved: number;
}

export interface EvalsOptions {
  /** Where result directories live. Defaults to the project's `eval/results`. */
  readonly resultsDir?: string;
  /** Where the golden files live. Defaults to the project's `eval/golden`. */
  readonly goldenDir?: string;
}

function listingOf(id: string, report: EvalReport): EvalListing {
  return {
    id,
    promptVersion: report.promptVersion,
    model: report.model,
    startedAt: report.startedAt,
    parts: report.parts.length,
    recall: report.set.recall,
    precision: report.set.precision,
    provenanceAccuracy: report.set.provenanceAccuracy,
    withinOnePage: report.set.withinOnePage,
    costUsd: report.costUsd,
    turns: report.turns,
    starved: report.starved.length,
  };
}

export interface ParameterScoreRow {
  readonly key: ParameterKey;
  readonly correct: number;
  readonly stated: number;
  readonly accuracy: number;
  /** Parts where this parameter was wrong, so the row leads somewhere. */
  readonly wrongParts: readonly string[];
  readonly missingParts: readonly string[];
  readonly citationExact: number;
  readonly citationWithinOne: number;
}

/**
 * The per-parameter view of a result.
 *
 * This is the table that says what to fix next: `maxDutyCycle` correct five
 * times in fourteen is a convention that was never decided, not fourteen
 * separate mistakes.
 */
export function parameterScores(report: EvalReport): ParameterScoreRow[] {
  const rows = new Map<ParameterKey, {
    correct: number;
    stated: number;
    wrong: string[];
    missing: string[];
    exact: number;
    withinOne: number;
  }>();
  for (const part of report.parts) {
    for (const parameter of part.score.parameters) {
      const row = rows.get(parameter.key) ?? {
        correct: 0,
        stated: 0,
        wrong: [],
        missing: [],
        exact: 0,
        withinOne: 0,
      };
      if (parameter.score === 'correct') {
        row.correct += 1;
      }
      if (parameter.score !== 'absent') {
        row.stated += 1;
      }
      if (parameter.score === 'wrong') {
        row.wrong.push(part.mpn);
      }
      if (parameter.score === 'missing') {
        row.missing.push(part.mpn);
      }
      if (parameter.page === 'exact') {
        row.exact += 1;
      }
      if (parameter.page === 'within_one') {
        row.withinOne += 1;
      }
      rows.set(parameter.key, row);
    }
  }
  return [...rows.entries()]
    .map(([key, row]) => ({
      key,
      correct: row.correct,
      stated: row.stated,
      accuracy: rate(row.correct, row.stated),
      wrongParts: row.wrong,
      missingParts: row.missing,
      citationExact: row.exact,
      citationWithinOne: row.withinOne,
    }))
    .sort((a, b) => a.accuracy - b.accuracy);
}

export interface FailureRow {
  readonly mpn: string;
  readonly key: ParameterKey;
  readonly score: string;
  readonly page: string;
  readonly expected: unknown;
  readonly actual: unknown;
}

/** Every parameter that did not score `correct`, worst first, for the inspector. */
export function failures(report: EvalReport): FailureRow[] {
  const rows: FailureRow[] = [];
  for (const part of report.parts) {
    for (const parameter of part.score.parameters) {
      if (parameter.score === 'correct' || parameter.score === 'absent') {
        continue;
      }
      rows.push({
        mpn: part.mpn,
        key: parameter.key,
        score: parameter.score,
        page: parameter.page,
        expected: parameter.expected,
        actual: parameter.actual,
      });
    }
  }
  return rows;
}

export interface GoldenHealth {
  readonly parts: number;
  readonly issues: readonly HealthIssue[];
  readonly coverage: Readonly<Record<string, number>>;
  /** Parameters with fewer than the three examples the checklist asks for. */
  readonly thin: readonly string[];
}

export interface Evals {
  list(): Promise<readonly EvalListing[]>;
  report(id: string): Promise<EvalReport>;
  summary(id: string): Promise<string>;
  compare(fromId: string, toId: string): Promise<Comparison>;
  golden(): readonly LoadedGolden[];
  goldenHealth(): GoldenHealth;
}

export function createEvals(options: EvalsOptions = {}): Evals {
  const resultsDir = options.resultsDir ?? RESULTS_DIR;
  const goldenDir = options.goldenDir ?? 'eval/golden';

  const read = async (id: string): Promise<EvalReport> => {
    if (id.includes('/') || id.includes('\\') || id.startsWith('.')) {
      throw new WebError(400, 'WEB_BAD_RESULT_ID', `${id} is not a result directory name`);
    }
    const file = path.join(resultsDir, id, REPORT_FILE);
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      throw new WebError(404, 'WEB_RESULT_NOT_FOUND', `no evaluation result called ${id}`, {
        cause: error,
        details: { id },
      });
    }
    return parseOrThrow(EvalReport, JSON.parse(text), `evaluation result ${id}`);
  };

  return {
    async list() {
      let names: string[];
      try {
        names = await readdir(resultsDir);
      } catch {
        return [];
      }
      const listings: EvalListing[] = [];
      for (const name of names.sort().reverse()) {
        const file = path.join(resultsDir, name, REPORT_FILE);
        try {
          await stat(file);
        } catch {
          continue;
        }
        listings.push(listingOf(name, await read(name)));
      }
      return listings;
    },

    report: read,

    async summary(id) {
      const file = path.join(resultsDir, id, SUMMARY_FILE);
      try {
        return await readFile(file, 'utf8');
      } catch (error) {
        throw new WebError(404, 'WEB_SUMMARY_NOT_FOUND', `no summary for ${id}`, {
          cause: error,
          details: { id },
        });
      }
    },

    async compare(fromId, toId) {
      const [from, to] = await Promise.all([read(fromId), read(toId)]);
      return compareReports(from, to);
    },

    golden() {
      return loadGoldenSet(goldenDir);
    },

    goldenHealth() {
      const golden = loadGoldenSet(goldenDir);
      const counts = coverage(golden);
      return {
        parts: golden.length,
        issues: checkGoldenHealth(golden),
        coverage: counts,
        thin: Object.entries(counts)
          .filter(([, count]) => count < 3)
          .map(([key]) => key)
          .sort(),
      };
    },
  };
}
