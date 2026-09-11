import { z } from 'zod';

import { Iso8601, NormalisedMpn, PromptVersion } from './primitives.js';

/**
 * What a run was for.
 *
 * Extraction is the only kind there is: the verification pass is a separate
 * run with its own prompt, and it adds its kind when it exists rather than
 * being named here first.
 */
export const RUN_KINDS = ['extract'] as const;
export const RunKind = z.enum(RUN_KINDS);
export type RunKind = z.output<typeof RunKind>;

/**
 * How a run ended, for the part rather than for the harness.
 *
 * `extracted` means a part was stored; `needs_human` that the run handed a
 * question to a person; `rejected` that neither happened, whatever the
 * reason.
 */
export const RUN_RESULTS = ['extracted', 'needs_human', 'rejected'] as const;
export const RunResult = z.enum(RUN_RESULTS);
export type RunResult = z.output<typeof RunResult>;

/** What the run did, counted from the ledger rather than from the transcript. */
export const RunDetails = z.strictObject({
  /** The harness's own word for how the run ended: `success`, `error_max_turns`. */
  subtype: z.string().trim().min(1).max(64),
  /** Why the run was rejected. Absent when it was not. */
  reason: z.string().trim().min(1).max(2000).optional(),
  toolCalls: z.int().nonnegative(),
  /** Tool calls that ended in an error, by tool name, in order. */
  toolFailures: z.array(z.string()),
  escalations: z.int().nonnegative(),
  /** Calls the money gate refused. */
  spendDenials: z.int().nonnegative(),
  /** Whether a part was stored by this run. */
  stored: z.boolean(),
});
export type RunDetails = z.output<typeof RunDetails>;

/**
 * One agent run over one part number.
 *
 * A row is written when the run starts and completed when it ends, so a run
 * that never came back is visible as one with no result rather than absent.
 * Everything that describes the ending — the time, the turns, the cost, the
 * details — arrives together with the result and is absent without it.
 */
export const Run = z
  .strictObject({
    id: z.uuid(),
    mpn: NormalisedMpn,
    kind: RunKind,
    promptVersion: PromptVersion,
    model: z.string().trim().min(1).max(64),
    /** The harness session, once the run has one. */
    sessionId: z.string().trim().min(1).max(128).optional(),
    startedAt: Iso8601,
    endedAt: Iso8601.optional(),
    turns: z.int().nonnegative().optional(),
    /** Estimated cost in US dollars, as the harness reports it. */
    costUsd: z.number().nonnegative().optional(),
    result: RunResult.optional(),
    details: RunDetails.optional(),
  })
  .superRefine((run, ctx) => {
    const finished = run.result !== undefined;
    const companions = {
      endedAt: run.endedAt,
      turns: run.turns,
      costUsd: run.costUsd,
      details: run.details,
    };
    for (const [field, value] of Object.entries(companions)) {
      if ((value !== undefined) === finished) {
        continue;
      }
      ctx.addIssue({
        code: 'custom',
        path: [field],
        message: finished
          ? `a finished run must record ${field}`
          : `${field} belongs to a finished run, which needs a result`,
      });
    }
    if (run.endedAt !== undefined && Date.parse(run.endedAt) < Date.parse(run.startedAt)) {
      ctx.addIssue({
        code: 'custom',
        path: ['endedAt'],
        message: 'endedAt cannot be earlier than startedAt',
      });
    }
  });
export type Run = z.output<typeof Run>;

/**
 * A run that has ended.
 *
 * The same record with the fields an ending brings no longer optional, so
 * code that only ever sees finished runs — a report, a command line — reads
 * them without a fallback for a state it cannot be in. `RunRepository.finish`
 * builds one from the ending it was given, which is what makes this a
 * narrowing rather than a claim.
 */
export interface FinishedRun extends Run {
  readonly endedAt: string;
  readonly turns: number;
  readonly costUsd: number;
  readonly result: RunResult;
  readonly details: RunDetails;
}
