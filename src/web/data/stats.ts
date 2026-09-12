import type { FinishedRun } from '../../core/run.js';
import type { Part } from '../../core/part.js';
import { PARAMETER_KEYS } from '../../core/parameter-keys.js';
import type { Run, RunResult } from '../../core/run.js';
import type { ToolCallRecord } from '../../core/tool-call-record.js';
import { elementAt } from '../../util/array.js';
import { required } from '../../util/present.js';
import {
  bucketByTime,
  countBy,
  cumulative,
  rate,
  summarise,
  sumBy,
  type Granularity,
  type Summary,
} from './aggregate.js';

/**
 * What the agent work cost and how it behaved.
 *
 * Every number here is measured, never modelled: spend comes from the run
 * rows the harness wrote, timings and failures from the ledger. Where a
 * figure is an estimate — what a sweep would cost — it says so in its name.
 */

export interface SpendPoint {
  readonly key: string;
  readonly runs: number;
  readonly costUsd: number;
  readonly turns: number;
  /** Spend from the first bucket up to and including this one. */
  readonly cumulativeUsd: number;
}

export function spendOverTime(runs: readonly Run[], granularity: Granularity = 'day'): SpendPoint[] {
  const buckets = bucketByTime(runs, (run) => run.startedAt, granularity);
  const costs = buckets.map((bucket) => sumBy(bucket.items, (run) => run.costUsd ?? 0));
  const running = cumulative(costs);
  return buckets.map((bucket, index) => ({
    key: bucket.key,
    runs: bucket.items.length,
    costUsd: elementAt(costs, index),
    turns: sumBy(bucket.items, (run) => run.turns ?? 0),
    cumulativeUsd: elementAt(running, index),
  }));
}

export const SPEND_DIMENSIONS = ['model', 'kind', 'promptVersion', 'mpn', 'result'] as const;
export type SpendDimension = (typeof SPEND_DIMENSIONS)[number];

export interface SpendBreakdown {
  readonly key: string;
  readonly runs: number;
  readonly costUsd: number;
  readonly turns: number;
  readonly meanCostUsd: number;
  /** Runs that ended in anything but a stored or verified part. */
  readonly unsuccessful: number;
}

function dimensionOf(run: Run, dimension: SpendDimension): string {
  switch (dimension) {
    case 'model':
      return run.model;
    case 'kind':
      return run.kind;
    case 'promptVersion':
      return run.promptVersion;
    case 'mpn':
      return run.mpn;
    case 'result':
      return run.result ?? 'unfinished';
  }
}

const SUCCESSFUL: readonly RunResult[] = Object.freeze(['extracted', 'verified']);

export function spendBy(runs: readonly Run[], dimension: SpendDimension): SpendBreakdown[] {
  const groups = new Map<string, Run[]>();
  for (const run of runs) {
    const key = dimensionOf(run, dimension);
    const held = groups.get(key);
    if (held === undefined) {
      groups.set(key, [run]);
      continue;
    }
    held.push(run);
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const costUsd = sumBy(group, (run) => run.costUsd ?? 0);
      return {
        key,
        runs: group.length,
        costUsd,
        turns: sumBy(group, (run) => run.turns ?? 0),
        meanCostUsd: costUsd / group.length,
        unsuccessful: group.filter(
          (run) => run.result === undefined || !SUCCESSFUL.includes(run.result),
        ).length,
      };
    })
    .sort((a, b) => b.costUsd - a.costUsd);
}

export interface RunTotals {
  readonly runs: number;
  readonly finished: number;
  readonly costUsd: number;
  readonly turns: number;
  readonly byResult: Readonly<Record<string, number>>;
  readonly cost: Summary | undefined;
  readonly turnsPerRun: Summary | undefined;
  /** Wall-clock duration of finished runs, in milliseconds. */
  readonly duration: Summary | undefined;
  readonly toolCalls: number;
  readonly toolFailures: number;
  readonly escalations: number;
  readonly spendDenials: number;
  readonly cacheMisses: number;
}

export function runTotals(runs: readonly Run[]): RunTotals {
  // A result and the fields an ending brings arrive together or not at all
  // (the `Run` schema enforces it), so a run with a result can be read as a
  // finished one rather than through a fallback per field.
  const finished = runs.filter((run): run is FinishedRun => run.result !== undefined);
  const durations = finished.map((run) => Date.parse(run.endedAt) - Date.parse(run.startedAt));
  return {
    runs: runs.length,
    finished: finished.length,
    costUsd: sumBy(runs, (run) => run.costUsd ?? 0),
    turns: sumBy(runs, (run) => run.turns ?? 0),
    byResult: Object.fromEntries(countBy(runs, (run) => run.result ?? 'unfinished')),
    cost: summarise(finished.map((run) => run.costUsd)),
    turnsPerRun: summarise(finished.map((run) => run.turns)),
    duration: summarise(durations),
    toolCalls: sumBy(runs, (run) => run.details?.toolCalls ?? 0),
    toolFailures: sumBy(runs, (run) => run.details?.toolFailures.length ?? 0),
    escalations: sumBy(runs, (run) => run.details?.escalations ?? 0),
    spendDenials: sumBy(runs, (run) => run.details?.spendDenials ?? 0),
    cacheMisses: sumBy(runs, (run) => run.details?.cacheMisses ?? 0),
  };
}

export interface ToolStat {
  readonly tool: string;
  readonly calls: number;
  readonly failures: number;
  readonly failureRate: number;
  /** Calls that could have spent money, whether or not they did. */
  readonly spending: number;
  /** Present because a tool in this list has been called at least once. */
  readonly duration: Summary;
  readonly totalMs: number;
  /** Failure codes and how often each one came up. */
  readonly errors: Readonly<Record<string, number>>;
}

/** Per-tool behaviour, busiest first. */
export function toolStats(records: readonly ToolCallRecord[]): ToolStat[] {
  const byTool = new Map<string, ToolCallRecord[]>();
  for (const record of records) {
    const held = byTool.get(record.tool);
    if (held === undefined) {
      byTool.set(record.tool, [record]);
      continue;
    }
    held.push(record);
  }
  return [...byTool.entries()]
    .map(([tool, calls]) => {
      const failed = calls.filter((call) => call.error !== undefined);
      return {
        tool,
        calls: calls.length,
        failures: failed.length,
        failureRate: rate(failed.length, calls.length),
        spending: calls.filter((call) => call.spendsQuota).length,
        duration: required(
          summarise(calls.map((call) => call.durationMs)),
          'the timings of a tool that was called',
        ),
        totalMs: sumBy(calls, (call) => call.durationMs),
        errors: Object.fromEntries(
          countBy(failed, (call) => required(call.error, 'the error on a failed call').code),
        ),
      };
    })
    .sort((a, b) => b.calls - a.calls);
}

export interface ErrorStat {
  readonly code: string;
  readonly count: number;
  readonly tools: readonly string[];
  readonly latestAt: string;
  readonly message: string;
}

/** Every failure code the ledger holds, most frequent first. */
export function errorStats(records: readonly ToolCallRecord[]): ErrorStat[] {
  const byCode = new Map<string, { count: number; tools: Set<string>; latestAt: string; message: string }>();
  for (const record of records) {
    if (record.error === undefined) {
      continue;
    }
    const held = byCode.get(record.error.code);
    if (held === undefined) {
      byCode.set(record.error.code, {
        count: 1,
        tools: new Set([record.tool]),
        latestAt: record.startedAt,
        message: record.error.message,
      });
      continue;
    }
    held.count += 1;
    held.tools.add(record.tool);
    if (record.startedAt > held.latestAt) {
      held.latestAt = record.startedAt;
      held.message = record.error.message;
    }
  }
  return [...byCode.entries()]
    .map(([code, held]) => ({
      code,
      count: held.count,
      tools: [...held.tools].sort(),
      latestAt: held.latestAt,
      message: held.message,
    }))
    .sort((a, b) => b.count - a.count);
}

export interface CacheStats {
  /** Calls refused because the cache had nothing and the run could not fetch. */
  readonly misses: number;
  readonly callsThatCouldMiss: number;
  readonly missRate: number;
  /** Misses by cache namespace, which is what says where the gap is. */
  readonly byNamespace: Readonly<Record<string, number>>;
}

function namespaceOf(record: ToolCallRecord): string {
  const details = record.error?.details;
  const namespace = details?.namespace;
  return typeof namespace === 'string' ? namespace : record.tool;
}

/**
 * What the cache could not answer.
 *
 * A run with no budget that wants an uncached page fails with `CACHE_MISS`,
 * and those failures are the measurement: they are the parts of an
 * evaluation that scored the cache rather than the prompt.
 */
export function cacheStats(records: readonly ToolCallRecord[]): CacheStats {
  const misses = records.filter((record) => record.error?.code === 'CACHE_MISS');
  const couldMiss = records.filter((record) => record.spendsQuota || record.error?.code === 'CACHE_MISS');
  return {
    misses: misses.length,
    callsThatCouldMiss: couldMiss.length,
    missRate: rate(misses.length, couldMiss.length),
    byNamespace: Object.fromEntries(countBy(misses, namespaceOf)),
  };
}

export interface GateStats {
  readonly decisions: Readonly<Record<string, number>>;
  readonly total: number;
  /** Calls the gate stopped, as a share of everything it looked at. */
  readonly denialRate: number;
}

const GATE_TOOL = 'spend_gate';

/** What the money gate decided, from its own ledger entries. */
export function gateStats(records: readonly ToolCallRecord[]): GateStats {
  const gates = records.filter((record) => record.tool === GATE_TOOL);
  const decisions = countBy(gates, (record) => {
    const output = record.output;
    if (typeof output !== 'object' || output === null || Array.isArray(output)) {
      return 'unknown';
    }
    const decision = (output as Record<string, unknown>).decision;
    return typeof decision === 'string' ? decision : 'unknown';
  });
  return {
    decisions: Object.fromEntries(decisions),
    total: gates.length,
    denialRate: rate((decisions.get('deny') ?? 0) + (decisions.get('ask') ?? 0), gates.length),
  };
}

export interface ValueCost {
  readonly parts: number;
  readonly parametersStated: number;
  readonly parametersVerified: number;
  readonly extractionUsd: number;
  readonly verificationUsd: number;
  readonly totalUsd: number;
  readonly perPart: number;
  readonly perStatedParameter: number;
  readonly perVerifiedParameter: number;
}

/**
 * What a stored value cost.
 *
 * The question this project asks of itself: $87 bought 660 parameters, so a
 * parameter costs thirteen cents and a part four dollars. Anything that
 * lowers either number is worth doing; anything that does not is a rewrite
 * for its own sake.
 */
export function valueCost(parts: readonly Part[], runs: readonly Run[]): ValueCost {
  let stated = 0;
  let verified = 0;
  for (const part of parts) {
    for (const key of PARAMETER_KEYS) {
      const parameter = part.parameters[key];
      if (parameter.value !== null) {
        stated += 1;
      }
      if (parameter.confidence === 'verified') {
        verified += 1;
      }
    }
  }
  const extractionUsd = sumBy(
    runs.filter((run) => run.kind === 'extract'),
    (run) => run.costUsd ?? 0,
  );
  const verificationUsd = sumBy(
    runs.filter((run) => run.kind === 'verify'),
    (run) => run.costUsd ?? 0,
  );
  const totalUsd = extractionUsd + verificationUsd;
  return {
    parts: parts.length,
    parametersStated: stated,
    parametersVerified: verified,
    extractionUsd,
    verificationUsd,
    totalUsd,
    perPart: rate(totalUsd, parts.length),
    perStatedParameter: rate(totalUsd, stated),
    perVerifiedParameter: rate(verificationUsd, verified),
  };
}

export interface SweepEstimate {
  readonly parts: number;
  readonly basis: number;
  readonly meanCostUsd: number;
  readonly p90CostUsd: number;
  readonly estimateUsd: number;
  readonly worstCaseUsd: number;
}

/**
 * What running this over `parts` parts would cost, from what it has cost.
 *
 * Both numbers are offered because they answer different questions: the mean
 * is what to expect, the ninetieth percentile is what to be ready for. With
 * no history there is nothing to estimate from, and the estimate is zero
 * rather than a guess.
 */
export function estimateSweep(runs: readonly Run[], parts: number, kind: Run['kind']): SweepEstimate {
  const costs = runs
    .filter((run): run is FinishedRun => run.kind === kind && run.result !== undefined)
    .map((run) => run.costUsd);
  const summary = summarise(costs);
  const mean = summary?.mean ?? 0;
  const p90 = summary?.p90 ?? 0;
  return {
    parts,
    basis: costs.length,
    meanCostUsd: mean,
    p90CostUsd: p90,
    estimateUsd: mean * parts,
    worstCaseUsd: p90 * parts,
  };
}

export interface SessionNode {
  readonly record: ToolCallRecord;
  readonly children: readonly SessionNode[];
}

/**
 * A session's calls as the tree their parent links describe.
 *
 * A gate decision is recorded as a child of the call it gated, so the shape
 * carries something a flat list does not: which calls were questioned.
 */
export function sessionTree(records: readonly ToolCallRecord[]): SessionNode[] {
  const byParent = new Map<string, ToolCallRecord[]>();
  const roots: ToolCallRecord[] = [];
  const ids = new Set(records.map((record) => record.id));
  for (const record of records) {
    if (record.parentId === undefined || !ids.has(record.parentId)) {
      roots.push(record);
      continue;
    }
    const held = byParent.get(record.parentId);
    if (held === undefined) {
      byParent.set(record.parentId, [record]);
      continue;
    }
    held.push(record);
  }
  const build = (record: ToolCallRecord): SessionNode => {
    const children = byParent.get(record.id);
    return { record, children: children === undefined ? [] : children.map(build) };
  };
  return roots.map(build);
}
