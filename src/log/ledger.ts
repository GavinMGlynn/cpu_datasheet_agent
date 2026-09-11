import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ToolCallRecord } from '../core/tool-call-record.js';
import { parseOrThrow } from '../core/validation-error.js';
import { ChipAgentError, isChipAgentError } from '../errors.js';

export class LedgerError extends ChipAgentError {}

export interface LedgerOptions {
  /** Directory holding `YYYY-MM-DD.jsonl` files and the `blobs/` directory. */
  readonly dir: string;
  readonly sessionId: string;
  readonly clock?: () => Date;
  readonly idGenerator?: () => string;
  /** Applied to input, output, and error before they are written. Defaults to identity. */
  readonly redact?: (value: unknown) => unknown;
  /** Outputs whose JSON exceeds this many bytes are written to a blob file. Default 64 KiB. */
  readonly sidecarThresholdBytes?: number;
}

export interface BeginOptions {
  readonly spendsQuota: boolean;
  readonly parentId?: string;
}

export type Outcome = { readonly output: unknown } | { readonly error: unknown };

/** Reference stored in place of an oversized output. */
export interface BlobRef {
  readonly $blob: { readonly path: string; readonly sha256: string; readonly bytes: number };
}

interface Pending {
  readonly tool: string;
  readonly input: unknown;
  readonly startedAt: Date;
  readonly spendsQuota: boolean;
  readonly parentId: string | undefined;
}

export const DEFAULT_SIDECAR_THRESHOLD_BYTES = 64 * 1024;

export function ledgerFileName(date: Date): string {
  return `${date.toISOString().slice(0, 10)}.jsonl`;
}

/**
 * Drops keys whose value is `undefined`, recursively.
 *
 * `undefined` is not JSON, and the record schema rejects it. Without this, an
 * error carrying an undefined detail would fail to record and the caller would
 * see the logging failure instead of the failure it was recording (D28) — and
 * a tool answering with an optional field it had nothing to put in would do
 * the same, though every transport drops it on the way out.
 */
function jsonSafe(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => jsonSafe(item) ?? null);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const safe = jsonSafe(child);
    if (safe !== undefined) {
      out[key] = safe;
    }
  }
  return out;
}

/** Serialises any thrown value into the ledger's error shape. */
export function toErrorJson(error: unknown): Record<string, unknown> {
  if (isChipAgentError(error)) {
    return jsonSafe({ ...error.toJSON() }) as Record<string, unknown>;
  }
  if (error instanceof Error) {
    return { name: error.name, code: 'UNKNOWN', message: error.message, details: {} };
  }
  return { name: 'NonError', code: 'UNKNOWN', message: String(error), details: {} };
}

/**
 * Append-only record of every tool call. `begin` registers a call and
 * returns its id; `end` validates the completed record against
 * `ToolCallRecord` and appends it as one JSON line to the day's file. Writes
 * are queued so concurrent calls never interleave.
 */
export class ToolCallLedger {
  private readonly pending = new Map<string, Pending>();
  private queue: Promise<void> = Promise.resolve();
  private readonly clock: () => Date;
  private readonly nextId: () => string;
  private readonly redact: (value: unknown) => unknown;
  private readonly threshold: number;

  constructor(private readonly options: LedgerOptions) {
    this.clock = options.clock ?? ((): Date => new Date());
    this.nextId = options.idGenerator ?? randomUUID;
    this.redact = options.redact ?? ((value: unknown): unknown => value);
    this.threshold = options.sidecarThresholdBytes ?? DEFAULT_SIDECAR_THRESHOLD_BYTES;
  }

  get sessionId(): string {
    return this.options.sessionId;
  }

  /** Number of calls begun but not yet ended. */
  get pendingCount(): number {
    return this.pending.size;
  }

  begin(tool: string, input: unknown, options: BeginOptions): string {
    const id = this.nextId();
    this.pending.set(id, {
      tool,
      input,
      startedAt: this.clock(),
      spendsQuota: options.spendsQuota,
      parentId: options.parentId,
    });
    return id;
  }

  /** Completes a call. Resolves once the line is on disk. */
  async end(id: string, outcome: Outcome): Promise<ToolCallRecord> {
    const call = this.pending.get(id);
    if (call === undefined) {
      throw new LedgerError('LEDGER_UNKNOWN_CALL', `no pending tool call with id ${id}`, {
        details: { id },
      });
    }
    this.pending.delete(id);
    const endedAt = this.clock();
    const durationMs = Math.max(0, Math.round(endedAt.getTime() - call.startedAt.getTime()));
    const base = {
      id,
      sessionId: this.options.sessionId,
      ...(call.parentId === undefined ? {} : { parentId: call.parentId }),
      tool: call.tool,
      input: jsonSafe(this.redact(call.input)) ?? null,
      startedAt: call.startedAt.toISOString(),
      durationMs,
      spendsQuota: call.spendsQuota,
    };
    const subject = `ToolCallRecord for ${call.tool}`;
    const candidate =
      'error' in outcome
        ? { ...base, error: this.redact(toErrorJson(outcome.error)) }
        : { ...base, output: jsonSafe(this.redact(outcome.output)) ?? null };
    const validated = parseOrThrow(ToolCallRecord, candidate, subject);
    const record =
      validated.output === undefined
        ? validated
        : parseOrThrow(
            ToolCallRecord,
            { ...validated, output: await this.storeOutput(validated.output) },
            subject,
          );
    await this.append(ledgerFileName(call.startedAt), `${JSON.stringify(record)}\n`);
    return record;
  }

  /** Resolves when every queued write has completed. */
  flush(): Promise<void> {
    return this.queue;
  }

  private async storeOutput(output: unknown): Promise<unknown> {
    const json = JSON.stringify(output);
    const bytes = Buffer.byteLength(json, 'utf8');
    if (bytes <= this.threshold) {
      return output;
    }
    const sha256 = createHash('sha256').update(json).digest('hex');
    const relative = path.join('blobs', `${sha256}.json`);
    const absolute = path.join(this.options.dir, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, json, 'utf8');
    const ref: BlobRef = { $blob: { path: relative, sha256, bytes } };
    return ref;
  }

  private append(fileName: string, line: string): Promise<void> {
    const write = async (): Promise<void> => {
      await mkdir(this.options.dir, { recursive: true });
      await appendFile(path.join(this.options.dir, fileName), line, 'utf8');
    };
    const next = this.queue.then(write);
    // Keep the chain alive after a failure so later writes still run; the
    // failure itself surfaces to the caller of `end`.
    this.queue = next.catch((): void => undefined);
    return next;
  }
}
