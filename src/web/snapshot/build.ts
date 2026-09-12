import type { Part } from '../../core/part.js';
import type { Run } from '../../core/run.js';
import type { ApiDeps } from '../api/deps.js';
import {
  catalogTotals,
  parameterCoverage,
  summariseParts,
  type CoverageCell,
  type PartSummary,
} from '../data/catalog.js';
import type { Granularity } from '../data/aggregate.js';
import type { EvalListing } from '../data/evals.js';
import {
  cacheStats,
  errorStats,
  runTotals,
  spendBy,
  spendOverTime,
  toolStats,
  valueCost,
  type ErrorStat,
  type RunTotals,
  type SpendBreakdown,
  type SpendPoint,
  type ValueCost,
} from '../data/stats.js';

/**
 * What a shareable snapshot contains, and what it deliberately does not.
 *
 * Excluded in code rather than by convention (D68): no credential, no
 * environment value, no datasheet text or page image — those are the
 * manufacturers' copyright, which is why `eval/golden/work/` is not committed
 * either — and no ledger payload, because a raw distributor response is the
 * distributor's data and not ours to republish.
 *
 * What is left is this project's own measurements: what it found, what it
 * cost, and how well it scored.
 */

export interface SnapshotPart {
  readonly mpn: string;
  readonly manufacturer: string;
  readonly status: string;
  readonly stated: number;
  readonly cited: number;
  readonly verified: number;
  readonly confirmed: number;
  readonly contradicted: number;
  readonly unchecked: number;
  readonly offers: number;
  readonly bestPriceAud: number | null;
}

export interface SnapshotToolStat {
  readonly tool: string;
  readonly calls: number;
  readonly failures: number;
  readonly medianMs: number;
  readonly p90Ms: number;
}

export interface Snapshot {
  readonly takenAt: string;
  readonly version: string;
  readonly source: string;
  readonly totals: ReturnType<typeof catalogTotals>;
  readonly runs: RunTotals;
  readonly value: ValueCost;
  readonly spend: readonly SpendPoint[];
  /** What one point of `spend` covers, which the chart says out loud. */
  readonly spendGranularity: Granularity;
  readonly spendByModel: readonly SpendBreakdown[];
  readonly coverage: readonly CoverageCell[];
  readonly parts: readonly SnapshotPart[];
  readonly tools: readonly SnapshotToolStat[];
  readonly errors: readonly ErrorStat[];
  readonly cache: ReturnType<typeof cacheStats>;
  readonly evaluations: readonly EvalListing[];
  /** Stated on the page itself, so a reader knows what is missing. */
  readonly excluded: readonly string[];
}

export const EXCLUSIONS: readonly string[] = Object.freeze([
  'credentials, and every value read from the environment',
  'datasheet text and rendered pages, which are the manufacturers’ copyright',
  'the inputs and outputs of tool calls, which hold distributors’ data',
  'part numbers and prices are included; nothing else from a distributor is',
]);

/**
 * A day is the bucket a project measured in weeks wants. When everything was
 * spent inside one day the chart would be a single point, so the hour stands
 * in — it is the same measurement at the only resolution that shows a shape.
 * The bucket travels with the points, because the page names it.
 */
function spendPoints(runs: readonly Run[]): {
  readonly points: readonly SpendPoint[];
  readonly granularity: Granularity;
} {
  const daily = spendOverTime(runs, 'day');
  return daily.length > 1
    ? { points: daily, granularity: 'day' }
    : { points: spendOverTime(runs, 'hour'), granularity: 'hour' };
}

function partOf(summary: PartSummary): SnapshotPart {
  return {
    mpn: summary.mpn,
    manufacturer: summary.manufacturer,
    status: summary.status,
    stated: summary.parameters.stated,
    cited: summary.parameters.cited,
    verified: summary.parameters.verified,
    confirmed: summary.verdicts.confirmed,
    contradicted: summary.verdicts.contradicted,
    unchecked: summary.verdicts.unchecked,
    offers: summary.offerCount,
    bestPriceAud: summary.bestPrice?.currency === 'AUD' ? summary.bestPrice.amount : null,
  };
}

export interface SnapshotOptions {
  readonly source?: string;
  readonly now?: () => Date;
}

/** Reads everything the page shows, from the same read models the site uses. */
export async function buildSnapshot(
  deps: ApiDeps,
  options: SnapshotOptions = {},
): Promise<Snapshot> {
  const source = options.source ?? 'live';
  const opened = await deps.sources.open(source);
  const parts: readonly Part[] = opened.repositories.parts.findParts();
  const runs: readonly Run[] = opened.repositories.runs.list({ limit: 10_000 });
  await deps.ledger.refresh();
  const calls = deps.ledger.all();
  const spend = spendPoints(runs);

  return {
    takenAt: (options.now ?? ((): Date => new Date()))().toISOString(),
    version: deps.version,
    source,
    totals: catalogTotals(parts),
    runs: runTotals(runs),
    value: valueCost(parts, runs),
    spend: spend.points,
    spendGranularity: spend.granularity,
    spendByModel: spendBy(runs, 'model'),
    coverage: parameterCoverage(parts),
    parts: summariseParts(parts, { quantity: 100, currency: 'AUD' }).map(partOf),
    tools: toolStats(calls).map((tool) => ({
      tool: tool.tool,
      calls: tool.calls,
      failures: tool.failures,
      medianMs: tool.duration.p50,
      p90Ms: tool.duration.p90,
    })),
    errors: errorStats(calls),
    cache: cacheStats(calls),
    evaluations: await deps.evals.list(),
    excluded: EXCLUSIONS,
  };
}
