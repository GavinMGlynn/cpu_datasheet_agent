import type { ParameterKey } from '../core/index.js';
import type { EvalReport } from './report.js';
import type { PageScore, Score } from './scorer.js';

/** How good a score is, for deciding whether one run did worse than another. */
const SCORE_RANK: Readonly<Record<Score, number>> = Object.freeze({
  correct: 3,
  absent: 3,
  missing: 1,
  wrong: 0,
  extra: 0,
});

const PAGE_RANK: Readonly<Record<PageScore, number>> = Object.freeze({
  exact: 3,
  within_one: 2,
  wrong: 1,
  none: 0,
});

export interface ParameterChange {
  readonly mpn: string;
  readonly key: ParameterKey;
  readonly from: Score;
  readonly to: Score;
  readonly fromPage: PageScore;
  readonly toPage: PageScore;
}

export interface Comparison {
  readonly from: { readonly promptVersion: string; readonly model: string };
  readonly to: { readonly promptVersion: string; readonly model: string };
  /** Parameters that scored worse, or whose citation did. */
  readonly regressions: readonly ParameterChange[];
  readonly improvements: readonly ParameterChange[];
  /** Parts one run covered and the other did not. */
  readonly onlyInFrom: readonly string[];
  readonly onlyInTo: readonly string[];
  readonly totals: {
    readonly recall: readonly [number, number];
    readonly precision: readonly [number, number];
    readonly provenanceAccuracy: readonly [number, number];
    readonly costUsd: readonly [number, number];
  };
}

interface ParameterOutcome {
  readonly mpn: string;
  readonly key: ParameterKey;
  readonly score: Score;
  readonly page: PageScore;
}

function scoresOf(report: EvalReport): Map<string, ParameterOutcome> {
  const scores = new Map<string, ParameterOutcome>();
  for (const part of report.parts) {
    for (const parameter of part.score.parameters) {
      scores.set(`${part.mpn}:${parameter.key}`, {
        mpn: part.mpn,
        key: parameter.key,
        score: parameter.score,
        page: parameter.page,
      });
    }
  }
  return scores;
}

/**
 * Compares two evaluation results, parameter by parameter.
 *
 * A regression is a parameter that scored worse, or one whose citation did: a
 * value that stays right while its page drifts is still a change for the
 * worse, and the citation is half of what this project promises.
 *
 * Parts only one run covered are listed rather than counted, because a
 * comparison across different sets is not a comparison of prompts.
 */
export function compareReports(from: EvalReport, to: EvalReport): Comparison {
  const before = scoresOf(from);
  const after = scoresOf(to);
  const regressions: ParameterChange[] = [];
  const improvements: ParameterChange[] = [];
  for (const [key, was] of before) {
    const now = after.get(key);
    if (now === undefined) {
      continue;
    }
    const change: ParameterChange = {
      mpn: was.mpn,
      key: was.key,
      from: was.score,
      to: now.score,
      fromPage: was.page,
      toPage: now.page,
    };
    const worse =
      SCORE_RANK[now.score] < SCORE_RANK[was.score] || PAGE_RANK[now.page] < PAGE_RANK[was.page];
    const better =
      SCORE_RANK[now.score] > SCORE_RANK[was.score] || PAGE_RANK[now.page] > PAGE_RANK[was.page];
    if (worse) {
      regressions.push(change);
    } else if (better) {
      improvements.push(change);
    }
  }
  const fromParts = new Set(from.parts.map((part) => part.mpn));
  const toParts = new Set(to.parts.map((part) => part.mpn));
  return {
    from: { promptVersion: from.promptVersion, model: from.model },
    to: { promptVersion: to.promptVersion, model: to.model },
    regressions,
    improvements,
    onlyInFrom: [...fromParts].filter((mpn) => !toParts.has(mpn)),
    onlyInTo: [...toParts].filter((mpn) => !fromParts.has(mpn)),
    totals: {
      recall: [from.set.recall, to.set.recall],
      precision: [from.set.precision, to.set.precision],
      provenanceAccuracy: [from.set.provenanceAccuracy, to.set.provenanceAccuracy],
      costUsd: [from.costUsd, to.costUsd],
    },
  };
}

function arrow(pair: readonly [number, number], asPercent = true): string {
  const render = (value: number): string =>
    asPercent ? `${(value * 100).toFixed(1)}%` : `$${value.toFixed(2)}`;
  return `${render(pair[0])} → ${render(pair[1])}`;
}

/** The comparison as a person reads it. */
export function renderComparison(comparison: Comparison): string {
  const lines: string[] = [];
  lines.push(
    `${comparison.from.promptVersion} / ${comparison.from.model}  →  ${comparison.to.promptVersion} / ${comparison.to.model}`,
  );
  lines.push('');
  lines.push(`recall     ${arrow(comparison.totals.recall)}`);
  lines.push(`precision  ${arrow(comparison.totals.precision)}`);
  lines.push(`citations  ${arrow(comparison.totals.provenanceAccuracy)}`);
  lines.push(`cost       ${arrow(comparison.totals.costUsd, false)}`);
  lines.push('');
  lines.push(
    `${String(comparison.regressions.length)} regression(s), ${String(comparison.improvements.length)} improvement(s)`,
  );
  for (const change of comparison.regressions) {
    lines.push(
      `  worse  ${change.mpn} ${change.key}: ${change.from}/${change.fromPage} → ${change.to}/${change.toPage}`,
    );
  }
  for (const change of comparison.improvements) {
    lines.push(
      `  better ${change.mpn} ${change.key}: ${change.from}/${change.fromPage} → ${change.to}/${change.toPage}`,
    );
  }
  if (comparison.onlyInFrom.length > 0 || comparison.onlyInTo.length > 0) {
    lines.push('');
    lines.push(
      `parts in one run only: ${[...comparison.onlyInFrom, ...comparison.onlyInTo].join(', ')}`,
    );
  }
  return lines.join('\n');
}
