import { z } from 'zod';

import { RunConfig, defaultRunConfig, policyFor } from '../../agent/config.js';
import { extractPart } from '../../agent/runner.js';
import { verifyPart } from '../../agent/verify.js';
import { SDK_QUERY, type QueryFn, type RunnerDeps } from '../../agent/execute.js';
import { AGENT_EFFORTS, type Config } from '../../config.js';
import type { FinishedRun } from '../../core/run.js';
import { PromptVersion } from '../../core/primitives.js';
import { parseOrThrow } from '../../core/validation-error.js';
import { describeError } from '../../errors.js';
import type { Logger } from '../../log/logger.js';
import { buildRegistry, createToolContext, type ToolContext } from '../../tools/index.js';
import type { Db } from '../../db/database.js';
import type { LaunchRegistry } from './registry.js';

/**
 * Starting runs from the browser.
 *
 * The money gates are the ones that already exist and are not reimplemented
 * here: `allowSpend` decides the quota policy and the `PreToolUse` hook, and
 * `maxCostUsd` is the ceiling the harness enforces on model calls (D12, D49,
 * D50). What this adds is a fourth: a ceiling per launch, checked before the
 * first part and between every part after it, because a batch of twenty at
 * four dollars each is a different decision from one run at four dollars
 * (D64).
 */

export const LaunchRequest = z.strictObject({
  kind: z.enum(['extract', 'verify']),
  /** The parts to run, in order. One is a single run; more is a batch. */
  mpns: z.array(z.string().trim().min(1).max(64)).min(1).max(200),
  actor: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(3).max(2000),
  model: z.string().trim().min(1).max(64).optional(),
  effort: z.enum(AGENT_EFFORTS).optional(),
  promptVersion: PromptVersion.optional(),
  maxTurns: z.int().positive().max(500).optional(),
  /** What one run may cost before the harness stops it. */
  maxCostUsd: z.number().positive().max(100).optional(),
  /** What the whole launch may cost before this stops starting parts. */
  ceilingUsd: z.number().positive().max(1000),
  /** Whether the run may spend money at a distributor or on model calls it caches. */
  allowSpend: z.boolean().default(false),
  /**
   * The caller has seen the estimate and accepts it. A literal rather than a
   * boolean: a request without it fails validation, so there is one gate
   * rather than a schema and a check that could disagree.
   */
  confirmed: z.literal(true),
});
export type LaunchRequest = z.output<typeof LaunchRequest>;

export interface LauncherDeps {
  readonly config: Config;
  readonly registry: LaunchRegistry;
  readonly logger: Logger;
  /** The harness. A test gives a scripted one. */
  readonly query?: QueryFn;
  /** Where the run writes. Defaults to the live store in the data directory. */
  readonly databasePath?: string;
}

export interface Launcher {
  /** Starts a launch and returns immediately with its id. */
  start(request: LaunchRequest): { readonly id: string; readonly promise: Promise<void> };
}

interface RunContext {
  readonly deps: RunnerDeps;
  readonly context: ToolContext;
  readonly db: Db;
}

function runConfigFor(config: Config, request: LaunchRequest): RunConfig {
  return parseOrThrow(
    RunConfig,
    {
      ...defaultRunConfig(config),
      ...(request.kind === 'verify' ? { promptVersion: 'verify.v1' } : {}),
      ...(request.model === undefined ? {} : { model: request.model }),
      ...(request.effort === undefined ? {} : { effort: request.effort }),
      ...(request.promptVersion === undefined ? {} : { promptVersion: request.promptVersion }),
      ...(request.maxTurns === undefined ? {} : { maxTurns: request.maxTurns }),
      ...(request.maxCostUsd === undefined ? {} : { maxCostUsd: request.maxCostUsd }),
      allowSpend: request.allowSpend,
    },
    'RunConfig',
  );
}

export function createLauncher(deps: LauncherDeps): Launcher {
  const query = deps.query ?? SDK_QUERY;

  const build = async (config: RunConfig, sessionId: string): Promise<RunContext> => {
    const built = await createToolContext({
      config: deps.config,
      sessionId,
      // The same policy the command line uses, from the same function: a run
      // that may not spend gets tools that refuse to.
      policy: policyFor(config),
      headless: true,
      ...(deps.databasePath === undefined ? {} : { databasePath: deps.databasePath }),
    });
    return {
      context: built.context,
      db: built.db,
      deps: {
        context: built.context,
        registry: buildRegistry(),
        query,
        logger: deps.logger,
      },
    };
  };

  const runOne = async (
    kind: LaunchRequest['kind'],
    mpn: string,
    config: RunConfig,
    context: RunContext,
  ): Promise<FinishedRun> => {
    const run =
      kind === 'extract'
        ? await extractPart(mpn, config, context.deps)
        : await verifyPart(mpn, config, context.deps);
    return run.run;
  };

  return {
    start(request) {
      const config = runConfigFor(deps.config, request);
      const record = deps.registry.create({
        kind: request.kind,
        mpns: request.mpns,
        model: config.model,
        promptVersion: config.promptVersion,
        maxCostUsd: config.maxCostUsd,
        allowSpend: config.allowSpend,
        actor: request.actor,
      });
      const id = record.id;

      const promise = (async (): Promise<void> => {
        let context: RunContext | undefined;
        let spent = 0;
        try {
          context = await build(config, id);
          deps.registry.emit(id, 'started', {
            parts: request.mpns.length,
            ceilingUsd: request.ceilingUsd,
            allowSpend: config.allowSpend,
            model: config.model,
            promptVersion: config.promptVersion,
          });
          for (const [index, mpn] of request.mpns.entries()) {
            if (deps.registry.cancelling(id)) {
              deps.registry.emit(id, 'cancelled', { after: index, spentUsd: spent });
              deps.registry.finish(id, 'cancelled');
              return;
            }
            if (spent >= request.ceilingUsd) {
              // The launch ceiling: checked between parts, where stopping is
              // free. Anything already started finishes.
              deps.registry.emit(id, 'finished', {
                reason: 'ceiling reached',
                spentUsd: spent,
                ran: index,
              });
              deps.registry.finish(id, 'finished');
              return;
            }
            deps.registry.emit(id, 'progress', { mpn, index, of: request.mpns.length });
            const finished = await runOne(request.kind, mpn, config, context);
            spent += finished.costUsd;
            deps.registry.addRun(id, finished);
            deps.registry.emit(id, 'part', {
              mpn: finished.mpn,
              result: finished.result,
              costUsd: finished.costUsd,
              turns: finished.turns,
              spentUsd: spent,
            });
          }
          deps.registry.emit(id, 'finished', { spentUsd: spent, ran: request.mpns.length });
          deps.registry.finish(id, 'finished');
        } catch (error) {
          const { message } = describeError(error);
          deps.logger.error('launch failed', { id, error: message });
          deps.registry.emit(id, 'failed', { error: message, spentUsd: spent });
          deps.registry.finish(id, 'failed', message);
        } finally {
          context?.db.close();
        }
      })();

      return { id, promise };
    },
  };
}
