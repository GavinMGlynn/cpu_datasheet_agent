import { parseArgs } from 'node:util';

import type { FinishedRun } from '../core/index.js';
import { loadConfig, type Config, type EnvSource } from '../config.js';
import { createLogger } from '../log/index.js';
import {
  NO_SPEND_POLICY,
  buildRegistry,
  type BuiltToolContext,
  type ToolContextOptions,
} from '../tools/index.js';
import { normaliseMpn } from '../mpn/index.js';
import { AlternateQuery, findAlternates, renderAlternates } from '../query/index.js';
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
  chip-run alternates <mpn> [--vin 8-36] [--iout 2] [--qty 100] [--currency AUD]
                            [--output fixed|adjustable] [--limit 5]
                            [--include-unverified]

options:
  --model <id>        model to run, default from AGENT_MODEL
  --effort <level>    low | medium | high | xhigh | max
  --max-turns <n>     turns before the harness stops the run
  --max-cost <usd>    what the run may cost before the harness stops it
  --prompt <version>  prompt version, such as extract.v1 or verify.v1
  --allow-spend       permit calls that spend API quota at a distributor
  --force             run parts a previous batch already finished
  --vin <min-max>     input range the alternate must cover, in volts
  --iout <amps>       output current the alternate must deliver
  --qty <n>           quantity the unit price is read at, default 1
  --currency <code>   currency prices are compared in, default from the locale
  --output <type>     fixed or adjustable; a fixed 5 V part is not an
                      alternate for an adjustable one
  --limit <n>         how many alternates to return, default 5
  --include-unverified  offer parts no verification pass has confirmed
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

/** What `alternates` was asked for, before the environment fills in the rest. */
export interface AlternateOptions {
  readonly vin?: string;
  readonly iout?: string;
  readonly quantity?: number;
  readonly currency?: string;
  readonly outputType?: string;
  readonly limit?: number;
  readonly includeUnverified: boolean;
}

export type CliCommand =
  | { readonly command: 'help' }
  | {
      readonly command: 'alternates';
      readonly mpn: string;
      readonly options: AlternateOptions;
    }
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
  vin: { type: 'string' },
  iout: { type: 'string' },
  qty: { type: 'string' },
  currency: { type: 'string' },
  output: { type: 'string' },
  limit: { type: 'string' },
  'include-unverified': { type: 'boolean' },
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
  if (command === 'alternates') {
    if (subject === undefined) {
      throw new AgentError('CLI_USAGE', 'alternates needs a part number');
    }
    return {
      command: 'alternates',
      mpn: subject,
      options: {
        ...(values.vin === undefined ? {} : { vin: values.vin }),
        ...(values.iout === undefined ? {} : { iout: values.iout }),
        ...(values.qty === undefined ? {} : { quantity: Number(values.qty) }),
        ...(values.currency === undefined ? {} : { currency: values.currency }),
        ...(values.output === undefined ? {} : { outputType: values.output }),
        ...(values.limit === undefined ? {} : { limit: Number(values.limit) }),
        includeUnverified: values['include-unverified'] === true,
      },
    };
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

/** The commands that start an agent run. */
export type RunCommand = Extract<
  CliCommand,
  { command: 'extract' | 'verify' | 'extract-many' | 'verify-pending' }
>;

/** A command that has been read and a configuration built from it. */
export type Planned =
  | {
      readonly kind: 'run';
      readonly command: RunCommand;
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
export function planRun(command: RunCommand, env: EnvSource, out: (line: string) => void): Planned {
  try {
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

/** `8-36` as the range a part has to cover. */
export function parseVinRange(text: string): { unit: 'V'; min: number; max: number } {
  const match = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/.exec(text);
  if (match === null) {
    throw new AgentError('CLI_USAGE', `--vin takes a range such as 8-36, and got ${text}`);
  }
  return {
    unit: 'V',
    min: Number(elementAt(match, 1)),
    max: Number(elementAt(match, 2)),
  };
}

function summarise(run: FinishedRun): string {
  return `${run.mpn}: ${run.result} in ${String(run.turns)} turns, $${run.costUsd.toFixed(2)}, ${String(run.details.toolCalls)} tool calls`;
}

/**
 * Cheaper parts that still meet the constraints, read out of what is stored.
 *
 * Nothing here spends anything or asks a model: it is a query over parts that
 * have already been extracted, and the disclaimer at the end of the answer is
 * part of the answer.
 */
async function alternates(
  command: Extract<CliCommand, { command: 'alternates' }>,
  deps: MainDeps,
): Promise<number> {
  const config = loadConfig(deps.env);
  const { context, db } = await deps.createContext({
    config,
    policy: NO_SPEND_POLICY,
    headless: true,
  });
  try {
    const { options } = command;
    const query = AlternateQuery.parse({
      mpn: normaliseMpn(command.mpn).mpn,
      ...(options.vin === undefined ? {} : { vinRange: parseVinRange(options.vin) }),
      ...(options.iout === undefined
        ? {}
        : { ioutMin: { value: Number(options.iout), unit: 'A' } }),
      quantity: options.quantity ?? 1,
      currency: options.currency ?? config.digikey.locale.currency,
      ...(options.outputType === undefined ? {} : { outputType: options.outputType }),
      includeUnverified: options.includeUnverified,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
    });
    deps.out(renderAlternates(findAlternates(context.repositories, query)));
    return 0;
  } catch (error) {
    deps.out(reason(error));
    return 2;
  } finally {
    db.close();
  }
}

/**
 * The command line over `extractPart` and `extractMany`.
 *
 * Returns the process's exit code: 0 when every run reached a conclusion —
 * a part stored or a question raised — 1 when one did not, and 2 when the
 * command line or the configuration was wrong.
 */
export async function main(argv: readonly string[], deps: MainDeps): Promise<number> {
  let parsed: CliCommand;
  try {
    parsed = parseCli(argv);
  } catch (error) {
    deps.out(reason(error));
    deps.out(USAGE);
    return 2;
  }
  if (parsed.command === 'help') {
    deps.out(USAGE);
    return 0;
  }
  if (parsed.command === 'alternates') {
    return alternates(parsed, deps);
  }
  const planned = planRun(parsed, deps.env, deps.out);
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
