import path from 'node:path';
import { parseArgs } from 'node:util';

import {
  DEFAULT_EXTRACT_PROMPT_VERSION,
  RunConfig,
  defaultRunConfig,
  policyFor,
  reason,
  type QueryFn,
} from '../agent/index.js';
import { loadConfig, type EnvSource } from '../config.js';
import { ChipAgentError } from '../errors.js';
import { createLogger } from '../log/index.js';
import { buildRegistry, type BuiltToolContext, type ToolContextOptions } from '../tools/index.js';
import { compareReports, renderComparison } from './compare.js';
import { runEval } from './harness.js';
import { checkGoldenHealth } from './health.js';
import { GOLDEN_DIR, loadGoldenSet } from './load.js';
import { readReport, toReport, writeReport, RESULTS_DIR } from './report.js';
import { renderReplay, replayRun } from './replay.js';

export class EvalCliError extends ChipAgentError {}

export const USAGE = `usage:
  chip-eval run [--parts A,B] [--model <id>] [--effort <level>] [--prompt <version>]
                [--max-turns <n>] [--max-cost <usd>] [--out <dir>] [--resume <id>]
  chip-eval compare <result-dir> <result-dir>
  chip-eval replay <run id>
  chip-eval health [--dir eval/golden]

Every evaluation run is a no-spend run: distributors and datasheets come from
the cache, so an evaluation costs model calls and nothing else. A part whose
run wanted something uncached is reported rather than scored quietly.

--resume takes the id printed in an earlier run's database path and carries
that evaluation on: parts it already finished are scored from what they
stored rather than run again.`;

const OPTIONS = {
  parts: { type: 'string' },
  dir: { type: 'string' },
  model: { type: 'string' },
  effort: { type: 'string' },
  prompt: { type: 'string' },
  'max-turns': { type: 'string' },
  'max-cost': { type: 'string' },
  out: { type: 'string' },
  resume: { type: 'string' },
  help: { type: 'boolean' },
} as const;

export type EvalCommand =
  | { readonly command: 'help' }
  | {
      readonly command: 'run';
      readonly only?: readonly string[];
      readonly out: string;
      /** The id of an evaluation to carry on: its database, its finished parts. */
      readonly resume?: string;
      readonly overrides: Record<string, unknown>;
    }
  | { readonly command: 'compare'; readonly from: string; readonly to: string }
  | { readonly command: 'replay'; readonly id: string }
  | { readonly command: 'health'; readonly dir: string };

/** Reads a command line. Strict: an unknown option is a refusal. */
export function parseEvalCli(argv: readonly string[]): EvalCommand {
  let parsed;
  try {
    parsed = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true });
  } catch (error) {
    throw new EvalCliError('CLI_USAGE', reason(error), { cause: error });
  }
  const { values, positionals } = parsed;
  if (values.help === true) {
    return { command: 'help' };
  }
  const [command, first, second] = positionals;
  if (command === 'run') {
    const only = values.parts?.split(',').map((part) => part.trim());
    return {
      command: 'run',
      ...(only === undefined ? {} : { only }),
      ...(values.resume === undefined ? {} : { resume: values.resume }),
      out: values.out ?? RESULTS_DIR,
      overrides: {
        ...(values.model === undefined ? {} : { model: values.model }),
        ...(values.effort === undefined ? {} : { effort: values.effort }),
        ...(values['max-turns'] === undefined ? {} : { maxTurns: Number(values['max-turns']) }),
        ...(values['max-cost'] === undefined ? {} : { maxCostUsd: Number(values['max-cost']) }),
        promptVersion: values.prompt ?? DEFAULT_EXTRACT_PROMPT_VERSION,
      },
    };
  }
  if (command === 'compare') {
    if (first === undefined || second === undefined) {
      throw new EvalCliError('CLI_USAGE', 'compare needs two result directories');
    }
    return { command: 'compare', from: first, to: second };
  }
  if (command === 'replay') {
    if (first === undefined) {
      throw new EvalCliError('CLI_USAGE', 'replay needs a run id');
    }
    return { command: 'replay', id: first };
  }
  if (command === 'health') {
    return { command: 'health', dir: values.dir ?? GOLDEN_DIR };
  }
  throw new EvalCliError('CLI_USAGE', `unknown command ${command ?? '(none)'}`);
}

export interface EvalDeps {
  readonly env: EnvSource;
  readonly query: QueryFn;
  readonly out: (line: string) => void;
  readonly createContext: (options: ToolContextOptions) => Promise<BuiltToolContext>;
  /** Identifies this evaluation, and names its database. */
  readonly newId: () => string;
}

/**
 * The command line over the evaluation harness.
 *
 * `run` gives the evaluation a database of its own: the tool surface includes
 * `get_part`, and a run that can read the answer out of an earlier run's work
 * is not measuring extraction.
 */
export async function main(argv: readonly string[], deps: EvalDeps): Promise<number> {
  let command: EvalCommand;
  try {
    command = parseEvalCli(argv);
  } catch (error) {
    deps.out(reason(error));
    deps.out(USAGE);
    return 2;
  }
  if (command.command === 'help') {
    deps.out(USAGE);
    return 0;
  }
  if (command.command === 'health') {
    const issues = checkGoldenHealth(loadGoldenSet(command.dir));
    for (const issue of issues) {
      deps.out(`${issue.kind}: ${issue.detail}`);
    }
    deps.out(`${String(issues.length)} issue(s)`);
    return issues.length === 0 ? 0 : 1;
  }

  const config = loadConfig(deps.env);
  if (command.command === 'compare' || command.command === 'replay') {
    // A missing directory or an id nothing matches is a mistake at the
    // command line, not a defect: it gets a sentence, not a stack trace.
    try {
      if (command.command === 'compare') {
        const [from, to] = await Promise.all([readReport(command.from), readReport(command.to)]);
        const comparison = compareReports(from, to);
        deps.out(renderComparison(comparison));
        return comparison.regressions.length === 0 ? 0 : 1;
      }
      const replay = await replayRun(
        path.join(config.dataDir, 'ledger'),
        command.id,
        (malformed) => {
          deps.out(`unreadable ledger line: ${JSON.stringify(malformed)}`);
        },
      );
      deps.out(renderReplay(replay));
      return 0;
    } catch (error) {
      deps.out(reason(error));
      return 2;
    }
  }

  let runConfig: RunConfig;
  try {
    runConfig = RunConfig.parse({
      ...defaultRunConfig(config),
      ...command.overrides,
      // An evaluation never spends: everything it needs is on disk already.
      allowSpend: false,
    });
  } catch (error) {
    deps.out(reason(error));
    return 2;
  }
  const id = command.resume ?? deps.newId();
  const logger = createLogger({ level: config.logLevel, fields: { name: 'chip-eval' } });
  const { context, db } = await deps.createContext({
    config,
    policy: policyFor(runConfig),
    headless: true,
    databasePath: path.join(config.dataDir, 'eval-runs', `${id}.sqlite`),
  });
  try {
    const result = await runEval({
      config: runConfig,
      deps: { context, registry: buildRegistry(), query: deps.query, logger },
      ...(command.only === undefined ? {} : { only: command.only }),
      ...(command.resume === undefined ? {} : { resume: true }),
      onPart: (mpn, index, total) => {
        deps.out(`[${String(index + 1)}/${String(total)}] ${mpn}`);
      },
    });
    const dir = await writeReport(toReport(result), command.out);
    deps.out(
      `recall ${(result.set.recall * 100).toFixed(1)}%, precision ${(result.set.precision * 100).toFixed(1)}%, citations ${(result.set.provenanceAccuracy * 100).toFixed(1)}%`,
    );
    deps.out(`$${result.costUsd.toFixed(2)} over ${String(result.turns)} turns`);
    deps.out(dir);
    return result.starved.length === 0 ? 0 : 1;
  } finally {
    db.close();
  }
}
