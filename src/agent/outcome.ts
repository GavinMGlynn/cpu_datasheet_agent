import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

import type { RunResult } from '../core/index.js';
import { readLedger, type MalformedLine, type ToolCallLedger } from '../log/index.js';

/** What the ledger says one run did. */
export interface LedgerSummary {
  readonly toolCalls: number;
  /** Names of the tools whose calls ended in an error, in order. */
  readonly toolFailures: readonly string[];
  /** Calls the money gate refused. */
  readonly spendDenials: number;
  /**
   * Calls that answered `needs_confirmation`: the run asked for something
   * that was not cached and it had no budget to fetch it. Not a failure in
   * itself, and a failure in an evaluation, where every answer is supposed to
   * be on disk already.
   */
  readonly needsConfirmation: number;
  /** Whether a part was stored. */
  readonly stored: boolean;
}

/** The gate's own records, which are about a tool call rather than one of them. */
const GATE = 'spend_gate';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads back what this run recorded.
 *
 * The run's own ledger entry is the parent of every call it made, so a run is
 * summarised by its children rather than by a time window — which is what
 * makes a batch of runs in one process countable at all.
 */
export async function summariseCalls(
  ledger: ToolCallLedger,
  parentId: string,
  onMalformed: (malformed: MalformedLine) => void,
): Promise<LedgerSummary> {
  let toolCalls = 0;
  let spendDenials = 0;
  let needsConfirmation = 0;
  let stored = false;
  const toolFailures: string[] = [];
  for await (const record of readLedger(ledger.dir, { sessionId: ledger.sessionId }, onMalformed)) {
    if (record.parentId !== parentId) {
      continue;
    }
    if (record.tool === GATE) {
      if (isRecord(record.output) && record.output.decision === 'deny') {
        spendDenials += 1;
      }
      continue;
    }
    toolCalls += 1;
    if (record.error !== undefined) {
      toolFailures.push(record.tool);
      continue;
    }
    if (isRecord(record.output) && record.output.status === 'needs_confirmation') {
      needsConfirmation += 1;
    }
    if (record.tool === 'upsert_part') {
      stored = true;
    }
  }
  return { toolCalls, toolFailures, spendDenials, needsConfirmation, stored };
}

/** How the harness says a run ended. */
export interface Ending {
  /** The harness's word for it: `success`, `error_max_turns`, `no_result`. */
  readonly subtype: string;
  readonly isError: boolean;
  /** The run's last words, or what the harness said went wrong. */
  readonly message: string;
}

/**
 * The ending as the harness reported it, or the absence of one.
 *
 * A harness that threw before saying anything and one that said nothing at
 * all are different failures, and neither is a run that ended.
 */
export function endingOf(
  result: SDKResultMessage | undefined,
  harnessError: string | undefined,
): Ending {
  if (result === undefined) {
    return {
      subtype: harnessError === undefined ? 'no_result' : 'harness_error',
      isError: true,
      message: harnessError ?? 'the harness produced no result message',
    };
  }
  return {
    subtype: result.subtype,
    isError: result.is_error,
    message: result.subtype === 'success' ? result.result : result.errors.join('; '),
  };
}

/** How a run ended, as the harness and the ledger together describe it. */
export interface ResultFacts extends Ending {
  readonly stored: boolean;
  readonly escalations: number;
}

export interface RunOutcome {
  readonly result: RunResult;
  readonly reason?: string | undefined;
}

const REASON_LIMIT = 500;

function clip(message: string): string {
  const trimmed = message.trim();
  if (trimmed === '') {
    return 'no reason given';
  }
  return trimmed.length <= REASON_LIMIT ? trimmed : `${trimmed.slice(0, REASON_LIMIT)}…`;
}

/**
 * What a run achieved for the part.
 *
 * A run that finished cleanly and stored a part is `extracted`. A run that
 * left a question for a person is `needs_human`, whether it stored anything
 * or not: the part is in the database with that status, and the question is
 * what the run is waiting on. Anything else is `rejected`, with the reason
 * kept so a batch of a hundred can be read afterwards.
 */
export function runOutcomeOf(facts: ResultFacts): RunOutcome {
  if (facts.subtype === 'success' && !facts.isError && facts.stored) {
    return { result: 'extracted' };
  }
  if (facts.escalations > 0) {
    return { result: 'needs_human' };
  }
  if (facts.subtype !== 'success') {
    return {
      result: 'rejected',
      reason: `the run ended as ${facts.subtype}: ${clip(facts.message)}`,
    };
  }
  if (facts.isError) {
    return { result: 'rejected', reason: `the run ended in an error: ${clip(facts.message)}` };
  }
  return {
    result: 'rejected',
    reason: 'the run finished without storing a part or raising a question',
  };
}
