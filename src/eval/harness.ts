import type { FinishedRun } from '../core/index.js';
import type { RunConfig, RunnerDeps } from '../agent/index.js';
import { extractPart } from '../agent/index.js';
import type { ParameterSet } from '../reconcile/types.js';
import { loadGoldenSet, type LoadedGolden } from './load.js';
import { scorePart, scoreSet, type PartScore, type SetScore } from './scorer.js';

/** One part's run, and how it scored. */
export interface PartResult {
  readonly mpn: string;
  readonly run: FinishedRun;
  readonly score: PartScore;
  /**
   * Calls that wanted something the cache did not have. An evaluation is
   * supposed to be free and repeatable, so any of these is a defect in the
   * run's setup rather than a result.
   */
  readonly cacheMisses: number;
}

export interface EvalResult {
  readonly startedAt: string;
  readonly endedAt: string;
  readonly promptVersion: string;
  readonly model: string;
  readonly effort: string;
  readonly parts: readonly PartResult[];
  readonly set: SetScore;
  readonly turns: number;
  readonly costUsd: number;
  /** Parts whose run wanted something that was not cached. */
  readonly starved: readonly string[];
}

export interface EvalOptions {
  readonly config: RunConfig;
  readonly deps: RunnerDeps;
  /** Which golden parts to run. Defaults to all of them. */
  readonly only?: readonly string[];
  /** The golden set, so a test can hand over one of its own. */
  readonly golden?: readonly LoadedGolden[];
  /** Called before each part, for a command line that wants to say where it is. */
  readonly onPart?: (mpn: string, index: number, total: number) => void;
}

/**
 * Runs the golden set through extraction and scores what it stored.
 *
 * Every run is a no-spend run: the distributors and the datasheets come from
 * the cache, so an evaluation costs model calls and nothing else, and is
 * repeatable next week. A part whose run had to ask for something uncached is
 * reported as starved rather than scored quietly — its score would be a
 * measurement of the cache, not of the prompt.
 *
 * A part the run failed to store scores as a part that stated nothing: no
 * credit, and the reason is in its run record.
 */
export async function runEval(options: EvalOptions): Promise<EvalResult> {
  const { config, deps } = options;
  const golden = (options.golden ?? loadGoldenSet()).filter(
    (entry) => options.only === undefined || options.only.includes(entry.part.mpn),
  );
  const startedAt = deps.context.now();
  const parts: PartResult[] = [];
  for (const [index, entry] of golden.entries()) {
    options.onPart?.(entry.part.mpn, index, golden.length);
    const { run, summary } = await extractPart(entry.part.mpn, config, deps);
    const stored = deps.context.repositories.parts.getPart(entry.part.mpn);
    const extracted: ParameterSet = stored === undefined ? {} : stored.parameters;
    parts.push({
      mpn: entry.part.mpn,
      run,
      score: scorePart(entry.part, extracted),
      cacheMisses: summary.needsConfirmation,
    });
  }
  return {
    startedAt,
    endedAt: deps.context.now(),
    promptVersion: config.promptVersion,
    model: config.model,
    effort: config.effort,
    parts,
    set: scoreSet(parts.map((part) => part.score)),
    turns: parts.reduce((total, part) => total + part.run.turns, 0),
    costUsd: parts.reduce((total, part) => total + part.run.costUsd, 0),
    starved: parts.filter((part) => part.cacheMisses > 0).map((part) => part.mpn),
  };
}
