import { parseArgs } from 'node:util';

import type { FinishedRun } from '../core/index.js';
import { loadConfig, type Config, type EnvSource } from '../config.js';
import { createLogger } from '../log/index.js';
import { buildRegistry, type BuiltToolContext, type ToolContextOptions } from '../tools/index.js';
import { elementAt } from '../util/array.js';
import { extractMany, pendingVerification, readMpnList, verifyMany } from './batch.js';
import { DEFAULT_VERIFY_PROMPT_VERSION, RunConfig, defaultRunConfig, policyFor } from './config.js';
import { AgentError } from './errors.js';
import type { QueryFn } from './execute.js';
import { extractPart } from './runner.js';
import { verifyPart } from './verify.js';

export const USAGE = `usage:
  chip-run extract <mpn> [options]
  chip-run extract-many <file> [options] [--force]
  chip-run verify <mpn> [options]
  chip-run verify-pending [options] [--force]

options:
  --model <id>        model to run, default from AGENT_MODEL
  --effort <level>    low | medium | high | xhigh | max
  --max-turns <n>     turns before the harness stops the run
  --max-cost <usd>    what the run may cost before the harness stops it
  --prompt <version>  prompt version, such as extract.v1 or verify.v1
  --allow-spend       permit calls that spend API quota at a distributor
  --force             run parts a previous batch already finished
  --help              print this

Without --allow-spend a run answers from the cache and reports anything it
would have had to pay for.`;

/** Fields a command line may set on top of the environment's defaults. */
export interface RunOverrides {
  readonly model?: string;
  readonly effort?: string;
  readonly maxTurns?: number;
  readonly maxCostUsd?: number;
  readonly promptVersion?: string;
  readonly allowSpend?: boolean;
}

export type CliCommand =
  | { readonly command: 'help' }
  | { readonly command: 'extract'; readonly mpn: string; readonly overrides: RunOverrides }
  | { readonly command: 'verify'; readonly mpn: string; readonly overrides: RunOverrides }
  | {
      readonly command: 'extract-many';
      readonly file: string;
      readonly force: boolean;
      readonly overrides: RunOverrides;
    }
  | {
      readonly command: 'verify-pending';
      readonly force: boolean;
      readonly overrides: RunOverrides;
    };

/** The commands that check a part rather than extract one. */
const VERIFYING: readonly string[] = ['verify', 'verify-pending'];

const OPTIONS = {
  model: { type: 'string' },
  effort: { type: 'string' },
  'max-turns': { type: 'string' },
  'max-cost': { type: 'string' },
  prompt: { type: 'string' },
  'allow-spend': { type: 'boolean' },
  force: { type: 'boolean' },
  help: { type: 'boolean' },
} as const;

/** The message a person should see for a thrown value. */
export function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads a command line.
 *
 * Strict: an unknown option is a refusal rather than something ignored, and a
 * numeric option that is not a number is left to `RunConfig` to reject, which
 * is where every other bound on a run already lives.
 */
export function parseCli(argv: readonly string[]): CliCommand {
  let parsed;
  try {
    parsed = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true });
  } catch (error) {
    throw new AgentError('CLI_USAGE', reason(error), { cause: error });
  }
  const { values, positionals } = parsed;
  if (values.help === true) {
    return { command: 'help' };
  }
  const overrides: RunOverrides = {
    ...(values.model === undefined ? {} : { model: values.model }),
    ...(values.effort === undefined ? {} : { effort: values.effort }),
    ...(values['max-turns'] === undefined ? {} : { maxTurns: Number(values['max-turns']) }),
    ...(values['max-cost'] === undefined ? {} : { maxCostUsd: Number(values['max-cost']) }),
    ...(values.prompt === undefined ? {} : { promptVersion: values.prompt }),
    ...(values['allow-spend'] === undefined ? {} : { allowSpend: values['allow-spend'] }),
  };
  const [command, subject, ...rest] = positionals;
  if (rest.length > 0) {
    throw new AgentError('CLI_USAGE', `unexpected argument ${elementAt(rest, 0)}`);
  }
  if (command === 'extract' || command === 'verify') {
    if (subject === undefined) {
      throw new AgentError('CLI_USAGE', `${command} needs a part number`);
    }
    return { command, mpn: subject, overrides };
  }
  if (command === 'extract-many') {
    if (subject === undefined) {
      throw new AgentError('CLI_USAGE', 'extract-many needs a file of part numbers');
    }
    return { command: 'extract-many', file: subject, force: values.force === true, overrides };
  }
  if (command === 'verify-pending') {
    if (subject !== undefined) {
      throw new AgentError('CLI_USAGE', `verify-pending takes no argument, and got ${subject}`);
    }
    return { command: 'verify-pending', force: values.force === true, overrides };
  }
  throw new AgentError('CLI_USAGE', `unknown command ${command ?? '(none)'}`);
}

export interface MainDeps {
  readonly env: EnvSource;
  /** The harness. The real one in `bin/`, a scripted one in a test. */
  readonly query: QueryFn;
  readonly out: (line: string) => void;
  readonly createContext: (options: ToolContextOptions) => Promise<BuiltToolContext>;
}

/** A command line that has been read and a configuration built from it. */
export type Planned =
  | {
      readonly kind: 'run';
      readonly command: Exclude<CliCommand, { command: 'help' }>;
      readonly config: Config;
      readonly runConfig: RunConfig;
    }
  | { readonly kind: 'exit'; readonly code: number };

/**
 * Reads the command line and the environment into one plan, or explains why
 * it cannot.
 *
 * Nothing here runs anything: a run's bounds are settled — its model, its
 * turn limit, its budget — before a tool context exists, so a mistyped
 * option costs a message rather than a database connection.
 */
export function planRun(
  argv: readonly string[],
  env: EnvSource,
  out: (line: string) => void,
): Planned {
  try {
    const command = parseCli(argv);
    if (command.command === 'help') {
      out(USAGE);
      return { kind: 'exit', code: 0 };
    }
    const config = loadConfig(env);
    // A verification run reads a different prompt, so the default follows the
    // command; `--prompt` still wins over both.
    const runConfig = RunConfig.parse({
      ...defaultRunConfig(config),
      ...(VERIFYING.includes(command.command)
        ? { promptVersion: DEFAULT_VERIFY_PROMPT_VERSION }
        : {}),
      ...command.overrides,
    });
    return { kind: 'run', command, config, runConfig };
  } catch (error) {
    out(reason(error));
    out(USAGE);
    return { kind: 'exit', code: 2 };
  }
}

function summarise(run: FinishedRun): string {
  return `${run.mpn}: ${run.result} in ${String(run.turns)} turns, $${run.costUsd.toFixed(2)}, ${String(run.details.toolCalls)} tool calls`;
}

/**
 * The command line over `extractPart` and `extractMany`.
 *
 * Returns the process's exit code: 0 when every run reached a conclusion —
 * a part stored or a question raised — 1 when one did not, and 2 when the
 * command line or the configuration was wrong.
 */
export async function main(argv: readonly string[], deps: MainDeps): Promise<number> {
  const planned = planRun(argv, deps.env, deps.out);
  if (planned.kind === 'exit') {
    return planned.code;
  }
  const { command, config, runConfig } = planned;
  const logger = createLogger({ level: config.logLevel, fields: { name: 'chip-run' } });
  const { context, db } = await deps.createContext({
    config,
    policy: policyFor(runConfig),
    headless: true,
  });
  try {
    const runnerDeps = { context, registry: buildRegistry(), query: deps.query, logger };
    if (command.command === 'extract' || command.command === 'verify') {
      const one =
        command.command === 'extract'
          ? await extractPart(command.mpn, runConfig, runnerDeps)
          : await verifyPart(command.mpn, runConfig, runnerDeps);
      deps.out(summarise(one.run));
      return one.run.result === 'rejected' ? 1 : 0;
    }
    const batch =
      command.command === 'extract-many'
        ? await extractMany(await readMpnList(command.file), runConfig, runnerDeps, {
            force: command.force,
          })
        : await verifyMany(pendingVerification(runnerDeps), runConfig, runnerDeps, {
            force: command.force,
          });
    for (const run of batch.runs) {
      deps.out(summarise(run));
    }
    deps.out(`${String(batch.runs.length)} run(s), ${String(batch.skipped.length)} skipped`);
    return batch.runs.some((run) => run.result === 'rejected') ? 1 : 0;
  } catch (error) {
    deps.out(reason(error));
    return 2;
  } finally {
    db.close();
  }
}
