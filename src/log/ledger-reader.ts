import { createReadStream } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { ToolCallRecord } from '../core/tool-call-record.js';
import { ChipAgentError } from '../errors.js';
import type { BlobRef } from './ledger.js';

export class LedgerReadError extends ChipAgentError {}

export interface ReadOptions {
  readonly sessionId?: string;
  readonly tool?: string;
  /** Inclusive lower bound on `startedAt`, ISO 8601. */
  readonly from?: string;
  /** Exclusive upper bound on `startedAt`, ISO 8601. */
  readonly to?: string;
}

export interface MalformedLine {
  readonly file: string;
  readonly line: number;
  readonly reason: string;
}

const LEDGER_FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

/** Day files in the ledger directory, oldest first. A missing directory yields none. */
export async function listLedgerFiles(dir: string): Promise<readonly string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw new LedgerReadError('LEDGER_DIR_UNREADABLE', `cannot read ledger directory ${dir}`, {
      cause: error,
      details: { dir },
    });
  }
  return names
    .filter((name) => LEDGER_FILE.test(name))
    .sort()
    .map((name) => path.join(dir, name));
}

function dayOf(file: string): string {
  return path.basename(file, '.jsonl');
}

function matches(record: ToolCallRecord, options: ReadOptions): boolean {
  if (options.sessionId !== undefined && record.sessionId !== options.sessionId) {
    return false;
  }
  if (options.tool !== undefined && record.tool !== options.tool) {
    return false;
  }
  if (options.from !== undefined && Date.parse(record.startedAt) < Date.parse(options.from)) {
    return false;
  }
  if (options.to !== undefined && Date.parse(record.startedAt) >= Date.parse(options.to)) {
    return false;
  }
  return true;
}

function fileInRange(file: string, options: ReadOptions): boolean {
  const day = dayOf(file);
  if (options.from !== undefined && day < options.from.slice(0, 10)) {
    return false;
  }
  if (options.to !== undefined && day > options.to.slice(0, 10)) {
    return false;
  }
  return true;
}

/**
 * Streams records across day files, oldest first, applying the filters.
 * Blank lines are skipped. Any other line that is not valid JSON or does not
 * satisfy `ToolCallRecord` is reported through `onMalformed` and skipped;
 * it is never silently dropped.
 */
export async function* readLedger(
  dir: string,
  options: ReadOptions,
  onMalformed: (malformed: MalformedLine) => void,
): AsyncGenerator<ToolCallRecord, void, undefined> {
  for (const file of await listLedgerFiles(dir)) {
    if (!fileInRange(file, options)) {
      continue;
    }
    const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
    let lineNumber = 0;
    for await (const line of lines) {
      lineNumber += 1;
      if (line.trim() === '') {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        onMalformed({
          file,
          line: lineNumber,
          reason: `invalid JSON: ${(error as Error).message}`,
        });
        continue;
      }
      const result = ToolCallRecord.safeParse(parsed);
      if (!result.success) {
        const reasons = result.error.issues.map(
          (issue) => `${issue.path.map(String).join('.')}: ${issue.message}`,
        );
        onMalformed({ file, line: lineNumber, reason: `invalid record: ${reasons.join('; ')}` });
        continue;
      }
      if (matches(result.data, options)) {
        yield result.data;
      }
    }
  }
}

export function isBlobRef(value: unknown): value is BlobRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$blob' in value &&
    typeof value.$blob === 'object' &&
    value.$blob !== null
  );
}

/** Loads an oversized output that the ledger stored beside the day files. */
export async function readBlob(dir: string, ref: BlobRef): Promise<unknown> {
  const absolute = path.join(dir, ref.$blob.path);
  let text: string;
  try {
    text = await readFile(absolute, 'utf8');
  } catch (error) {
    throw new LedgerReadError('LEDGER_BLOB_MISSING', `blob not found: ${ref.$blob.path}`, {
      cause: error,
      details: { path: ref.$blob.path },
    });
  }
  const parsed: unknown = JSON.parse(text);
  return parsed;
}
