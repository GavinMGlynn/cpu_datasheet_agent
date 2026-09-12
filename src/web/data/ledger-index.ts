import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';

import { ToolCallRecord } from '../../core/tool-call-record.js';
import { listLedgerFiles, type MalformedLine } from '../../log/ledger-reader.js';

/**
 * An in-memory index over the tool-call ledger.
 *
 * The ledger is append-only day files, and the site asks the same questions
 * of it on every page: what did this session do, how often does this tool
 * fail, how long does a page render take. Re-reading 7 MB per request to
 * answer those is the kind of cost that makes a page feel broken, so the
 * files are read once and re-read only from where they grew.
 */

export interface LedgerFilter {
  readonly sessionId?: string | undefined;
  readonly tool?: string | undefined;
  readonly parentId?: string | undefined;
  /** Inclusive lower bound on `startedAt`, ISO 8601. */
  readonly from?: string | undefined;
  /** Exclusive upper bound on `startedAt`. */
  readonly to?: string | undefined;
  /** Only calls that failed, or only calls that did not. */
  readonly failed?: boolean | undefined;
  /** Only calls that may spend money, or only calls that cannot. */
  readonly spendsQuota?: boolean | undefined;
  /** Case-insensitive match against the tool name and the serialised input. */
  readonly text?: string | undefined;
}

export interface RefreshResult {
  /** Records added by this refresh. */
  readonly added: number;
  readonly total: number;
  /** Day files seen, and how many of them had grown. */
  readonly files: number;
  readonly grew: number;
}

export interface LedgerTotals {
  readonly records: number;
  readonly sessions: number;
  readonly tools: number;
  readonly failures: number;
  readonly spending: number;
  readonly bytes: number;
  readonly malformed: number;
  readonly firstAt: string | undefined;
  readonly lastAt: string | undefined;
}

export interface LedgerIndex {
  /** Reads anything new. Safe to call on every request; it does nothing when nothing changed. */
  refresh(): Promise<RefreshResult>;
  all(): readonly ToolCallRecord[];
  find(id: string): ToolCallRecord | undefined;
  bySession(sessionId: string): readonly ToolCallRecord[];
  byTool(tool: string): readonly ToolCallRecord[];
  children(parentId: string): readonly ToolCallRecord[];
  /** Every record matching the filter, oldest first. */
  select(filter: LedgerFilter): readonly ToolCallRecord[];
  sessions(): readonly string[];
  tools(): readonly string[];
  malformed(): readonly MalformedLine[];
  totals(): LedgerTotals;
}

interface FileState {
  /** Bytes consumed up to and including the last complete line. */
  offset: number;
}

/**
 * Checks every criterion except the session, which `select` has already
 * applied by choosing the pool: a session filter narrows to that session's
 * records before anything else runs, so re-checking it here would be a
 * condition that can never be false.
 */
function matches(record: ToolCallRecord, filter: LedgerFilter, text: string | undefined): boolean {
  if (filter.tool !== undefined && record.tool !== filter.tool) {
    return false;
  }
  if (filter.parentId !== undefined && record.parentId !== filter.parentId) {
    return false;
  }
  if (filter.from !== undefined && record.startedAt < filter.from) {
    return false;
  }
  if (filter.to !== undefined && record.startedAt >= filter.to) {
    return false;
  }
  if (filter.failed !== undefined && (record.error !== undefined) !== filter.failed) {
    return false;
  }
  if (filter.spendsQuota !== undefined && record.spendsQuota !== filter.spendsQuota) {
    return false;
  }
  if (text !== undefined) {
    const haystack = `${record.tool} ${JSON.stringify(record.input)}`.toLowerCase();
    if (!haystack.includes(text)) {
      return false;
    }
  }
  return true;
}

function push<K>(index: Map<K, ToolCallRecord[]>, key: K, record: ToolCallRecord): void {
  const held = index.get(key);
  if (held === undefined) {
    index.set(key, [record]);
    return;
  }
  held.push(record);
}

export function createLedgerIndex(dir: string): LedgerIndex {
  const records: ToolCallRecord[] = [];
  const byId = new Map<string, ToolCallRecord>();
  const bySession = new Map<string, ToolCallRecord[]>();
  const byTool = new Map<string, ToolCallRecord[]>();
  const byParent = new Map<string, ToolCallRecord[]>();
  const files = new Map<string, FileState>();
  const malformed: MalformedLine[] = [];
  let bytes = 0;

  const add = (record: ToolCallRecord): void => {
    records.push(record);
    byId.set(record.id, record);
    push(bySession, record.sessionId, record);
    push(byTool, record.tool, record);
    if (record.parentId !== undefined) {
      push(byParent, record.parentId, record);
    }
  };

  const readFrom = async (file: string, state: FileState, size: number): Promise<number> => {
    let added = 0;
    let consumed = state.offset;
    const stream = createReadStream(file, { encoding: 'utf8', start: state.offset, end: size - 1 });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    let lineNumber = 0;
    for await (const line of lines) {
      lineNumber += 1;
      // The last line may be half-written: the ledger appends, and a read can
      // land mid-append. A line with no terminator yet is left for the next
      // pass rather than reported as malformed.
      const terminated = consumed + Buffer.byteLength(line) + 1 <= size;
      if (!terminated) {
        break;
      }
      consumed += Buffer.byteLength(line) + 1;
      if (line.trim() === '') {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        malformed.push({
          file,
          line: lineNumber,
          reason: `invalid JSON: ${(error as Error).message}`,
        });
        continue;
      }
      const result = ToolCallRecord.safeParse(parsed);
      if (!result.success) {
        malformed.push({
          file,
          line: lineNumber,
          reason: `invalid record: ${result.error.issues
            .map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`)
            .join('; ')}`,
        });
        continue;
      }
      add(result.data);
      added += 1;
    }
    stream.close();
    state.offset = consumed;
    return added;
  };

  return {
    async refresh() {
      let added = 0;
      let grew = 0;
      const found = await listLedgerFiles(dir);
      for (const file of found) {
        const state = files.get(file) ?? { offset: 0 };
        files.set(file, state);
        const { size } = await stat(file);
        if (size <= state.offset) {
          continue;
        }
        grew += 1;
        bytes += size - state.offset;
        added += await readFrom(file, state, size);
      }
      records.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      return { added, total: records.length, files: found.length, grew };
    },

    all: () => records,
    find: (id) => byId.get(id),
    bySession: (sessionId) => bySession.get(sessionId) ?? [],
    byTool: (tool) => byTool.get(tool) ?? [],
    children: (parentId) => byParent.get(parentId) ?? [],

    select(filter) {
      const text = filter.text?.toLowerCase();
      const pool =
        filter.sessionId !== undefined
          ? (bySession.get(filter.sessionId) ?? [])
          : filter.tool !== undefined
            ? (byTool.get(filter.tool) ?? [])
            : filter.parentId !== undefined
              ? (byParent.get(filter.parentId) ?? [])
              : records;
      return pool.filter((record) => matches(record, filter, text));
    },

    sessions: () => [...bySession.keys()],
    tools: () => [...byTool.keys()].sort(),
    malformed: () => malformed,

    totals() {
      let failures = 0;
      let spending = 0;
      for (const record of records) {
        if (record.error !== undefined) {
          failures += 1;
        }
        if (record.spendsQuota) {
          spending += 1;
        }
      }
      return {
        records: records.length,
        sessions: bySession.size,
        tools: byTool.size,
        failures,
        spending,
        bytes,
        malformed: malformed.length,
        firstAt: records[0]?.startedAt,
        lastAt: records[records.length - 1]?.startedAt,
      };
    },
  };
}
