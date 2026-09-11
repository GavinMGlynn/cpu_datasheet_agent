import { isBlobRef, readBlob, readLedger, type MalformedLine } from '../log/index.js';
import { ToolCallRecord, parseOrThrow } from '../core/index.js';
import { ChipAgentError } from '../errors.js';

export class ReplayError extends ChipAgentError {}

export interface ReplayedCall {
  readonly tool: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly input: unknown;
  readonly output: unknown;
  readonly error: unknown;
}

export interface Replay {
  /** The run's own ledger entry: what it was asked and what it concluded. */
  readonly run: ToolCallRecord;
  readonly calls: readonly ReplayedCall[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The record of a run with its output read back out of the blob store if it
 * went there.
 *
 * The loaded blob is the JSON that was written, so it satisfies the record's
 * own schema; it is parsed rather than asserted, which is what every other
 * boundary in this project does.
 */
async function resolve(dir: string, record: ToolCallRecord): Promise<ToolCallRecord> {
  if (!isBlobRef(record.output)) {
    return record;
  }
  const output = await readBlob(dir, record.output);
  return parseOrThrow(ToolCallRecord, { ...record, output }, `ledger record ${record.id}`);
}

/** Whether this entry records the run with that id. */
function isRunRecord(record: ToolCallRecord, id: string): boolean {
  if (record.id === id) {
    return true;
  }
  const output = record.output;
  if (!isRecord(output) || !isRecord(output.run)) {
    return false;
  }
  return output.run.id === id;
}

/**
 * Rebuilds one run from the ledger: what it was given, every tool call it
 * made, and what each returned.
 *
 * The id is either the run's — the one in the `runs` table — or its ledger
 * entry's. Oversized outputs were written beside the day files and are read
 * back here, so a replay shows what the model actually saw rather than a
 * reference to it.
 */
export async function replayRun(
  dir: string,
  id: string,
  onMalformed: (malformed: MalformedLine) => void,
): Promise<Replay> {
  let run: ToolCallRecord | undefined;
  const records: ToolCallRecord[] = [];
  for await (const record of readLedger(dir, {}, onMalformed)) {
    records.push(record);
    // A run's own entry holds its transcript, which is usually large enough
    // to have been written beside the day file. Reading it back is what lets
    // a run be found by the id in the `runs` table rather than by the
    // ledger's own.
    const candidate = record.tool.endsWith('_part') ? await resolve(dir, record) : record;
    if (isRunRecord(candidate, id)) {
      run = candidate;
    }
  }
  if (run === undefined) {
    throw new ReplayError('REPLAY_RUN_NOT_FOUND', `no run with id ${id} in the ledger at ${dir}`, {
      details: { id, dir },
    });
  }
  const parent = run;
  const children = records.filter((record) => record.parentId === parent.id);
  const calls: ReplayedCall[] = [];
  for (const record of children) {
    calls.push({
      tool: record.tool,
      startedAt: record.startedAt,
      durationMs: record.durationMs,
      input: record.input,
      output: isBlobRef(record.output) ? await readBlob(dir, record.output) : record.output,
      error: record.error,
    });
  }
  return { run, calls };
}

function summarise(value: unknown, width: number): string {
  const text = JSON.stringify(value);
  return text.length <= width ? text : `${text.slice(0, width)}…`;
}

/** The replay as a person reads it: one line per call, in order. */
export function renderReplay(replay: Replay, width = 120): string {
  const lines: string[] = [];
  lines.push(`${replay.run.tool} ${replay.run.id}`);
  lines.push(`  input   ${summarise(replay.run.input, width)}`);
  lines.push('');
  for (const call of replay.calls) {
    lines.push(`${call.startedAt}  ${call.tool} (${String(call.durationMs)} ms)`);
    lines.push(`  in   ${summarise(call.input, width)}`);
    if (call.error === undefined) {
      lines.push(`  out  ${summarise(call.output, width)}`);
    } else {
      lines.push(`  err  ${summarise(call.error, width)}`);
    }
  }
  return lines.join('\n');
}
