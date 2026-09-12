import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { toolCallRecord, type Loose } from '../../../test/helpers/core-fixtures.js';
import { createLedgerIndex, type LedgerIndex } from './ledger-index.js';

let dir: string;
let index: LedgerIndex;
let counter = 0;

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function record(overrides: Loose = {}): string {
  counter += 1;
  return `${JSON.stringify(toolCallRecord({ id: uuid(counter), ...overrides }))}\n`;
}

async function day(name: string, lines: readonly string[]): Promise<void> {
  await writeFile(path.join(dir, `${name}.jsonl`), lines.join(''));
}

beforeEach(async () => {
  counter = 0;
  dir = await mkdtemp(path.join(tmpdir(), 'chip-web-ledger-'));
  await mkdir(dir, { recursive: true });
  await day('2026-09-11', [
    record({
      sessionId: 'session-a',
      tool: 'resolve_mpn',
      input: { mpn: 'TPS54331DR' },
      startedAt: '2026-09-11T09:00:00Z',
      durationMs: 10,
    }),
    record({
      sessionId: 'session-a',
      tool: 'fetch_offers',
      parentId: uuid(1),
      input: { mpn: 'TPS54331DR' },
      startedAt: '2026-09-11T09:00:05Z',
      durationMs: 2200,
      spendsQuota: true,
    }),
    record({
      sessionId: 'session-b',
      tool: 'read_pages',
      input: { pages: [4] },
      output: undefined,
      error: { name: 'PdfError', code: 'PDF_PAGE_MISSING', message: 'no page 4', details: {} },
      startedAt: '2026-09-11T10:00:00Z',
      durationMs: 5,
    }),
  ]);
  index = createLedgerIndex(dir);
  await index.refresh();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('refresh', () => {
  it('reads every record once', async () => {
    expect(index.all()).toHaveLength(3);
    const again = await index.refresh();
    expect(again).toStrictEqual({ added: 0, total: 3, files: 1, grew: 0 });
  });

  it('reads only what was appended since last time', async () => {
    await appendFile(
      path.join(dir, '2026-09-11.jsonl'),
      record({ sessionId: 'session-c', tool: 'upsert_part', startedAt: '2026-09-11T11:00:00Z' }),
    );
    const result = await index.refresh();
    expect(result).toStrictEqual({ added: 1, total: 4, files: 1, grew: 1 });
  });

  it('picks up a new day file', async () => {
    await day('2026-09-12', [record({ tool: 'verify_part', startedAt: '2026-09-12T01:00:00Z' })]);
    const result = await index.refresh();
    expect(result.files).toBe(2);
    expect(result.added).toBe(1);
  });

  it('keeps everything in time order across files', async () => {
    await day('2026-09-10', [record({ tool: 'cache_stats', startedAt: '2026-09-10T08:00:00Z' })]);
    await index.refresh();
    expect(index.all().map((entry) => entry.startedAt)).toStrictEqual([
      '2026-09-10T08:00:00Z',
      '2026-09-11T09:00:00Z',
      '2026-09-11T09:00:05Z',
      '2026-09-11T10:00:00Z',
    ]);
  });

  it('waits for a half-written line rather than calling it malformed', async () => {
    const file = path.join(dir, '2026-09-11.jsonl');
    const line = record({ tool: 'upsert_part', startedAt: '2026-09-11T12:00:00Z' });
    await appendFile(file, line.slice(0, 40));
    expect((await index.refresh()).added).toBe(0);
    expect(index.malformed()).toStrictEqual([]);
    await appendFile(file, line.slice(40));
    expect((await index.refresh()).added).toBe(1);
  });

  it('reports a line that is not JSON and one that is not a record', async () => {
    await appendFile(path.join(dir, '2026-09-11.jsonl'), 'not json\n{"id":"nope"}\n\n');
    await index.refresh();
    expect(index.malformed()).toHaveLength(2);
    expect(index.malformed()[0]?.reason).toMatch(/invalid JSON/u);
    expect(index.malformed()[1]?.reason).toMatch(/invalid record/u);
  });

  it('has nothing to read when there is no ledger at all', async () => {
    const empty = createLedgerIndex(path.join(dir, 'nowhere'));
    expect(await empty.refresh()).toStrictEqual({ added: 0, total: 0, files: 0, grew: 0 });
    expect(empty.totals().records).toBe(0);
    expect(empty.totals().firstAt).toBeUndefined();
  });
});

describe('lookups', () => {
  it('finds one record by id', () => {
    expect(index.find(uuid(1))?.tool).toBe('resolve_mpn');
    expect(index.find('missing')).toBeUndefined();
  });

  it('indexes by session, tool and parent', () => {
    expect(index.bySession('session-a')).toHaveLength(2);
    expect(index.byTool('read_pages')).toHaveLength(1);
    expect(index.children(uuid(1))).toHaveLength(1);
    expect(index.bySession('nobody')).toStrictEqual([]);
    expect(index.byTool('nothing')).toStrictEqual([]);
    expect(index.children(uuid(99))).toStrictEqual([]);
  });

  it('lists the sessions and tools it has seen', () => {
    expect(index.sessions()).toStrictEqual(['session-a', 'session-b']);
    expect(index.tools()).toStrictEqual(['fetch_offers', 'read_pages', 'resolve_mpn']);
  });
});

describe('select', () => {
  it('filters by session, tool and parent, narrowing before it scans', () => {
    expect(index.select({ sessionId: 'session-a' })).toHaveLength(2);
    expect(index.select({ tool: 'fetch_offers' })).toHaveLength(1);
    expect(index.select({ parentId: uuid(1) })).toHaveLength(1);
    expect(index.select({ sessionId: 'session-a', tool: 'fetch_offers' })).toHaveLength(1);
  });

  it('applies the criteria it did not narrow on', () => {
    expect(index.select({ tool: 'resolve_mpn', sessionId: 'session-b' })).toStrictEqual([]);
    expect(index.select({ sessionId: 'session-a', parentId: uuid(1) })).toHaveLength(1);
  });

  it('finds nothing for a session, tool or parent it has never seen', () => {
    expect(index.select({ sessionId: 'nobody' })).toStrictEqual([]);
    expect(index.select({ tool: 'nothing' })).toStrictEqual([]);
    expect(index.select({ parentId: uuid(99) })).toStrictEqual([]);
  });

  it('filters by time window, failure and spending', () => {
    expect(index.select({ from: '2026-09-11T09:30:00Z' })).toHaveLength(1);
    expect(index.select({ to: '2026-09-11T09:30:00Z' })).toHaveLength(2);
    expect(index.select({ failed: true })).toHaveLength(1);
    expect(index.select({ failed: false })).toHaveLength(2);
    expect(index.select({ spendsQuota: true })).toHaveLength(1);
    expect(index.select({ spendsQuota: false })).toHaveLength(2);
  });

  it('searches the tool name and the input', () => {
    expect(index.select({ text: 'tps54331' })).toHaveLength(2);
    expect(index.select({ text: 'read_pages' })).toHaveLength(1);
    expect(index.select({ text: 'nothing here' })).toStrictEqual([]);
  });

  it('returns everything for an empty filter', () => {
    expect(index.select({})).toHaveLength(3);
  });
});

describe('totals', () => {
  it('counts what the ledger holds', () => {
    expect(index.totals()).toMatchObject({
      records: 3,
      sessions: 2,
      tools: 3,
      failures: 1,
      spending: 1,
      malformed: 0,
      firstAt: '2026-09-11T09:00:00Z',
      lastAt: '2026-09-11T10:00:00Z',
    });
    expect(index.totals().bytes).toBeGreaterThan(0);
  });
});
