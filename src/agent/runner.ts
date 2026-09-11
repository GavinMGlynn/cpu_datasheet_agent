import {
  query as sdkQuery,
  type Options,
  type SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk';

import type { Escalation, FinishedRun } from '../core/index.js';
import { type Logger, withLedger } from '../log/index.js';
import { createInProcessServer } from '../mcp/index.js';
import { normaliseMpn } from '../mpn/index.js';
import type { ToolContext, ToolRegistry } from '../tools/index.js';
import { policyFor, type RunConfig } from './config.js';
import { AgentError } from './errors.js';
import { SERVER_KEY, TOOL_MATCHER, TOOL_PREFIX, createSpendGate } from './hook.js';
import { runOutcomeOf, summariseCalls, type ResultFacts } from './outcome.js';
import { extractionRequest, loadPrompt } from './prompt.js';
import { condense, type TranscriptEntry } from './transcript.js';

/** The harness call this project makes: one query, driven to its result. */
export type QueryFn = typeof sdkQuery;

/** The real harness. Held as a value so a run can be given a scripted one. */
export const SDK_QUERY: QueryFn = sdkQuery;

export interface RunnerDeps {
  readonly context: ToolContext;
  readonly registry: ToolRegistry;
  readonly query: QueryFn;
  readonly logger: Logger;
}

export interface ExtractionRun {
  readonly run: FinishedRun;
  /** What was said and called, as the ledger keeps it. */
  readonly transcript: readonly TranscriptEntry[];
  /** Questions this run raised, from any tool that raises them. */
  readonly escalations: readonly Escalation[];
}

/** What the harness was told, minus the hook and the server. */
export function queryOptions(
  config: RunConfig,
  systemPrompt: string,
  deps: Pick<RunnerDeps, 'registry'>,
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
    allowedTools: deps.registry.names().map((name) => `${TOOL_PREFIX}${name}`),
    permissionMode: 'default',
    // Nobody is watching, so anything the hook does not allow is refused
    // rather than waiting for an answer that cannot come.
    permissionPrompts: 'none',
  };
}

function factsOf(
  result: SDKResultMessage | undefined,
  harnessError: string | undefined,
  stored: boolean,
  escalations: number,
): ResultFacts {
  if (result === undefined) {
    return {
      subtype: harnessError === undefined ? 'no_result' : 'harness_error',
      isError: true,
      stored,
      escalations,
      message: harnessError ?? 'the harness produced no result message',
    };
  }
  return {
    subtype: result.subtype,
    isError: result.is_error,
    stored,
    escalations,
    message: result.subtype === 'success' ? result.result : result.errors.join('; '),
  };
}

/**
 * Takes one part number through an extraction run.
 *
 * The run gets the tool surface as an in-process MCP server, no built-in
 * tools, a turn limit, a cost ceiling and the `PreToolUse` money gate. Its
 * row is written before the first message and completed after the last, so a
 * run that never came back is visible afterwards.
 *
 * Nothing here throws for a failed run: a harness that crashed, a model that
 * ran out of turns and a part stored cleanly are all endings, and all three
 * are recorded the same way. It throws only when the run could not be set up
 * — an unknown prompt version, a part number that is not one.
 */
export async function extractPart(
  mpn: string,
  config: RunConfig,
  deps: RunnerDeps,
): Promise<ExtractionRun> {
  const { context, registry, logger } = deps;
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
  const prompt = await loadPrompt(config.promptVersion);
  const normalised = normaliseMpn(mpn).mpn;
  const startedAt = context.now();
  const started = context.repositories.runs.start({
    id: context.newId(),
    mpn: normalised,
    kind: 'extract',
    promptVersion: prompt.version,
    model: config.model,
    startedAt,
  });

  const record = withLedger(
    context.ledger,
    { name: 'extract_part', spendsQuota: false },
    async (_input: unknown, { callId }): Promise<ExtractionRun> => {
      const options: Options = {
        ...queryOptions(config, prompt.text, deps),
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
        for await (const message of deps.query({
          prompt: extractionRequest(normalised),
          options,
        })) {
          sessionId = message.session_id;
          transcript.push(...condense(message));
          if (message.type === 'result') {
            result = message;
          }
        }
      } catch (error) {
        harnessError = error instanceof Error ? error.message : String(error);
        logger.error('extraction run failed', { mpn: normalised, error: harnessError });
      }

      const summary = await summariseCalls(context.ledger, callId, (malformed) => {
        logger.warn('unreadable ledger line', { ...malformed });
      });
      const escalations = context.repositories.escalations
        .list({ mpn: normalised })
        .filter((escalation) => escalation.createdAt >= startedAt);
      const facts = factsOf(result, harnessError, summary.stored, escalations.length);
      const outcome = runOutcomeOf(facts);
      const run = context.repositories.runs.finish(started.id, {
        endedAt: context.now(),
        turns: result?.num_turns ?? 0,
        costUsd: result?.total_cost_usd ?? 0,
        result: outcome.result,
        details: {
          subtype: facts.subtype,
          ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
          toolCalls: summary.toolCalls,
          toolFailures: [...summary.toolFailures],
          escalations: escalations.length,
          spendDenials: summary.spendDenials,
          stored: summary.stored,
        },
        ...(sessionId === undefined ? {} : { sessionId }),
      });
      logger.info('extraction run finished', {
        mpn: normalised,
        result: run.result,
        turns: run.turns,
        costUsd: run.costUsd,
      });
      return { run, transcript, escalations };
    },
  );

  return record({
    mpn: normalised,
    promptVersion: prompt.version,
    promptSha256: prompt.sha256,
    model: config.model,
    effort: config.effort,
    maxTurns: config.maxTurns,
    maxCostUsd: config.maxCostUsd,
    allowSpend: config.allowSpend,
  });
}
