import {
  query as sdkQuery,
  type Options,
  type SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk';

import type { FinishedRun, RunDetails, RunKind, RunResult } from '../core/index.js';
import { type Logger, withLedger } from '../log/index.js';
import { createInProcessServer } from '../mcp/index.js';
import { ToolRegistry, type ToolContext } from '../tools/index.js';
import { policyFor, type RunConfig } from './config.js';
import { AgentError } from './errors.js';
import { SERVER_KEY, TOOL_MATCHER, TOOL_PREFIX, createSpendGate } from './hook.js';
import { endingOf, summariseCalls, type Ending, type LedgerSummary } from './outcome.js';
import type { Prompt } from './prompt.js';
import { condense, type TranscriptEntry } from './transcript.js';

/** The harness call this project makes: one query, driven to its result. */
export type QueryFn = typeof sdkQuery;

/** The real harness. Held as a value so a run can be given a scripted one. */
export const SDK_QUERY: QueryFn = sdkQuery;

export interface RunnerDeps {
  readonly context: ToolContext;
  /** The whole tool surface. A run is given the part of it that run needs. */
  readonly registry: ToolRegistry;
  readonly query: QueryFn;
  readonly logger: Logger;
}

/** The named tools, as a registry of their own. */
export function restrict(registry: ToolRegistry, names: readonly string[]): ToolRegistry {
  return new ToolRegistry().addAll(names.map((name) => registry.get(name)));
}

/** What the harness was told, minus the hook and the server. */
export function queryOptions(
  config: RunConfig,
  systemPrompt: string,
  registry: ToolRegistry,
): Pick<
  Options,
  | 'model'
  | 'effort'
  | 'maxTurns'
  | 'maxBudgetUsd'
  | 'systemPrompt'
  | 'cwd'
  | 'settingSources'
  | 'tools'
  | 'allowedTools'
  | 'permissionMode'
  | 'permissionPrompts'
> {
  return {
    model: config.model,
    effort: config.effort,
    maxTurns: config.maxTurns,
    // The third part of the money gate, and the only one the agent cannot
    // reach at all: the harness stops the run when the model calls cost this
    // much, whatever the run is doing.
    maxBudgetUsd: config.maxCostUsd,
    systemPrompt,
    cwd: config.dataDir,
    // No settings files, no project instructions: a run is the prompt file,
    // the tools and nothing else, or the same prompt version means two
    // different things on two machines.
    settingSources: [],
    // Every built-in tool disabled. The run has no file system and no shell.
    tools: [],
    allowedTools: registry.names().map((name) => `${TOOL_PREFIX}${name}`),
    permissionMode: 'default',
    // Nobody is watching, so anything the hook does not allow is refused
    // rather than waiting for an answer that cannot come.
    permissionPrompts: 'none',
  };
}

/** What a run's own reckoning is given. */
export interface ConcludeInput {
  readonly ending: Ending;
  readonly summary: LedgerSummary;
  /** When the run started, for anything recorded during it. */
  readonly startedAt: string;
}

/** What a run's own reckoning says. */
export interface Conclusion<T> {
  readonly result: RunResult;
  readonly reason?: string | undefined;
  readonly escalations: number;
  /** Whether a part was written by this run. */
  readonly stored: boolean;
  readonly verdicts?: RunDetails['verdicts'];
  /** Whatever this kind of run has to hand back beyond the record. */
  readonly extra: T;
}

export interface RunSpec<T> {
  readonly kind: RunKind;
  /** Normalised: it goes into the run record. */
  readonly mpn: string;
  readonly config: RunConfig;
  readonly prompt: Prompt;
  /** The one instruction the run is given. */
  readonly request: string;
  /** The tools this run gets, which is not always all of them. */
  readonly registry: ToolRegistry;
  /** The context the tools run against, carrying this run's identity. */
  readonly context: ToolContext;
  readonly deps: RunnerDeps;
  readonly conclude: (input: ConcludeInput) => Promise<Conclusion<T>>;
}

export interface AgentRun<T> {
  readonly run: FinishedRun;
  /** What was said and called, as the ledger keeps it. */
  readonly transcript: readonly TranscriptEntry[];
  readonly extra: T;
}

/**
 * Runs one headless query and records it.
 *
 * Everything both kinds of run share lives here: the money gate, the
 * in-process tool server, the run row written before the first message and
 * completed after the last, and the ledger entry that every call of the run
 * hangs under. What differs is the prompt, the tools and the reckoning, and
 * those are the arguments.
 *
 * Nothing here throws for a failed run: a harness that crashed, a model that
 * ran out of turns and a part stored cleanly are all endings, and all three
 * are recorded the same way.
 */
export async function executeRun<T>(spec: RunSpec<T>): Promise<AgentRun<T>> {
  const { config, context, deps, registry } = spec;
  const { logger } = deps;
  // Both halves of the money gate read the same field (D12), so a context
  // whose policy disagrees with the run's is a wiring mistake, not a
  // configuration: one of the two would be enforcing a budget nobody set.
  const expected = policyFor(config);
  if (
    context.policy.allowConfirmedSpend !== expected.allowConfirmedSpend ||
    context.policy.autoConfirm !== expected.autoConfirm
  ) {
    throw new AgentError(
      'RUN_POLICY_MISMATCH',
      `the tool context's quota policy does not match a run with allowSpend ${String(config.allowSpend)}`,
      { details: { allowSpend: config.allowSpend, policy: { ...context.policy } } },
    );
  }

  const startedAt = context.now();
  const started = context.repositories.runs.start({
    id: context.newId(),
    mpn: spec.mpn,
    kind: spec.kind,
    promptVersion: spec.prompt.version,
    model: config.model,
    startedAt,
  });

  const record = withLedger(
    context.ledger,
    { name: `${spec.kind}_part`, spendsQuota: false },
    async (_input: unknown, { callId }): Promise<AgentRun<T>> => {
      const options: Options = {
        ...queryOptions(config, spec.prompt.text, registry),
        mcpServers: { [SERVER_KEY]: createInProcessServer(registry, context, callId) },
        hooks: {
          PreToolUse: [
            {
              matcher: TOOL_MATCHER,
              hooks: [
                createSpendGate({
                  registry,
                  allowSpend: config.allowSpend,
                  ledger: context.ledger,
                  parentId: callId,
                }),
              ],
            },
          ],
        },
      };

      const transcript: TranscriptEntry[] = [];
      let result: SDKResultMessage | undefined;
      let sessionId: string | undefined;
      let harnessError: string | undefined;
      try {
        for await (const message of deps.query({ prompt: spec.request, options })) {
          sessionId = message.session_id;
          transcript.push(...condense(message));
          if (message.type === 'result') {
            result = message;
          }
        }
      } catch (error) {
        harnessError = error instanceof Error ? error.message : String(error);
        logger.error('run failed', { kind: spec.kind, mpn: spec.mpn, error: harnessError });
      }

      const summary = await summariseCalls(context.ledger, callId, (malformed) => {
        logger.warn('unreadable ledger line', { ...malformed });
      });
      const ending = endingOf(result, harnessError);
      const conclusion = await spec.conclude({ ending, summary, startedAt });
      const run = context.repositories.runs.finish(started.id, {
        endedAt: context.now(),
        turns: result?.num_turns ?? 0,
        costUsd: result?.total_cost_usd ?? 0,
        result: conclusion.result,
        details: {
          subtype: ending.subtype,
          ...(conclusion.reason === undefined ? {} : { reason: conclusion.reason }),
          toolCalls: summary.toolCalls,
          toolFailures: [...summary.toolFailures],
          escalations: conclusion.escalations,
          spendDenials: summary.spendDenials,
          stored: conclusion.stored,
          ...(conclusion.verdicts === undefined ? {} : { verdicts: conclusion.verdicts }),
        },
        ...(sessionId === undefined ? {} : { sessionId }),
      });
      logger.info('run finished', {
        kind: spec.kind,
        mpn: spec.mpn,
        result: run.result,
        turns: run.turns,
        costUsd: run.costUsd,
      });
      return { run, transcript, extra: conclusion.extra };
    },
  );

  return record({
    mpn: spec.mpn,
    kind: spec.kind,
    promptVersion: spec.prompt.version,
    promptSha256: spec.prompt.sha256,
    model: config.model,
    effort: config.effort,
    maxTurns: config.maxTurns,
    maxCostUsd: config.maxCostUsd,
    allowSpend: config.allowSpend,
    tools: registry.names(),
  });
}

/** The context a run's tools see: the same one, told which run it is. */
export function contextFor(context: ToolContext, config: RunConfig, prompt: Prompt): ToolContext {
  return { ...context, run: { promptVersion: prompt.version, model: config.model } };
}
