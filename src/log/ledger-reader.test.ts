import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ToolCallLedger } from './ledger.js';
import {
  isBlobRef,
  listLedgerFiles,
  readBlob,
  readLedger,
  type MalformedLine,
} from './ledger-reader.js';

let root: string;
let dir: string;

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

async function populate(): Promise<void> {
  let n = 0;
  let now = Date.parse('2026-09-09T22:00:00Z');
  const ledger = new ToolCallLedger({
    dir,
    sessionId: 'A',
    clock: () => new Date(now),
    idGenerator: () => uuid(++n),
  });
  const other = new ToolCallLedger({
    dir,
    sessionId: 'B',
    clock: () => new Date(now),
    idGenerator: () => uuid(100 + ++n),
  });
  await ledger.end(ledger.begin('resolve_mpn', 1, { spendsQuota: false }), { output: 'a1' });
  now = Date.parse('2026-09-10T09:00:00Z');
  await other.end(other.begin('read_pages', 2, { spendsQuota: false }), { output: 'b1' });
  now = Date.parse('2026-09-10T12:00:00Z');
  await ledger.end(ledger.begin('read_pages', 3, { spendsQuota: false }), { output: 'a2' });
  now = Date.parse('2026-09-11T03:00:00Z');
  await ledger.end(ledger.begin('fetch_offers', 4, { spendsQuota: true }), { output: 'a3' });
}

async function collect(
  options: Parameters<typeof readLedger>[1] = {},
): Promise<{ outputs: unknown[]; malformed: MalformedLine[] }> {
  const malformed: MalformedLine[] = [];
  const outputs: unknown[] = [];
  for await (const record of readLedger(dir, options, (m) => malformed.push(m))) {
    outputs.push(record.output);
  }
  return { outputs, malformed };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ledger-read-'));
  dir = path.join(root, 'ledger');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('listLedgerFiles', () => {
  it('returns nothing for a missing directory', async () => {
    await expect(listLedgerFiles(dir)).resolves.toEqual([]);
  });

  it('returns only day files, sorted', async () => {
    await mkdir(path.join(dir, 'blobs'), { recursive: true });
    for (const name of [
      '2026-09-11.jsonl',
      'notes.txt',
      '2026-09-09.jsonl',
      '2026-9-9.jsonl',
      '2026-09-10.jsonl.bak',
    ]) {
      await writeFile(path.join(dir, name), '', 'utf8');
    }
    await expect(listLedgerFiles(dir)).resolves.toEqual([
      path.join(dir, '2026-09-09.jsonl'),
      path.join(dir, '2026-09-11.jsonl'),
    ]);
  });

  it('wraps other filesystem errors', async () => {
    await writeFile(dir, 'a file, not a directory', 'utf8');
    await expect(listLedgerFiles(dir)).rejects.toMatchObject({
      code: 'LEDGER_DIR_UNREADABLE',
      details: { dir },
    });
  });
});

describe('readLedger', () => {
  it('streams every record across day files, oldest first', async () => {
    await populate();
    expect(await collect()).toEqual({ outputs: ['a1', 'b1', 'a2', 'a3'], malformed: [] });
  });

  it('filters by session, tool, and time bounds', async () => {
    await populate();
    expect((await collect({ sessionId: 'A' })).outputs).toEqual(['a1', 'a2', 'a3']);
    expect((await collect({ tool: 'read_pages' })).outputs).toEqual(['b1', 'a2']);
    expect((await collect({ from: '2026-09-10T10:00:00Z' })).outputs).toEqual(['a2', 'a3']);
    expect((await collect({ to: '2026-09-10T12:00:00Z' })).outputs).toEqual(['a1', 'b1']);
    expect(
      (await collect({ from: '2026-09-10T00:00:00Z', to: '2026-09-11T00:00:00Z', sessionId: 'A' }))
        .outputs,
    ).toEqual(['a2']);
    expect((await collect({ sessionId: 'A', tool: 'fetch_offers' })).outputs).toEqual(['a3']);
  });

  it('skips blank lines and reports malformed ones with file and line number', async () => {
    await populate();
    const file = path.join(dir, '2026-09-10.jsonl');
    await appendFile(file, '\n{not json}\n{"id":"x"}\r\n\n', 'utf8');

    const { outputs, malformed } = await collect();

    expect(outputs).toEqual(['a1', 'b1', 'a2', 'a3']);
    expect(malformed).toEqual([
      { file, line: 4, reason: expect.stringMatching(/^invalid JSON: /) as string },
      { file, line: 5, reason: expect.stringMatching(/^invalid record: id: /) as string },
    ]);
  });

  it('yields nothing from a missing directory', async () => {
    expect(await collect()).toEqual({ outputs: [], malformed: [] });
  });
});

describe('isBlobRef', () => {
  it('recognises blob references only', () => {
    expect(isBlobRef({ $blob: { path: 'p', sha256: 's', bytes: 1 } })).toBe(true);
    expect(isBlobRef({ $blob: 'p' })).toBe(false);
    expect(isBlobRef({ $blob: null })).toBe(false);
    expect(isBlobRef({ path: 'p' })).toBe(false);
    expect(isBlobRef(null)).toBe(false);
    expect(isBlobRef('$blob')).toBe(false);
  });
});

describe('readBlob', () => {
  it('loads an output the ledger moved to a blob file', async () => {
    const ledger = new ToolCallLedger({ dir, sessionId: 's', sidecarThresholdBytes: 8 });
    const record = await ledger.end(ledger.begin('t', null, { spendsQuota: false }), {
      output: { long: 'x'.repeat(50) },
    });
    expect(isBlobRef(record.output)).toBe(true);
    if (!isBlobRef(record.output)) {
      return;
    }
    await expect(readBlob(dir, record.output)).resolves.toEqual({ long: 'x'.repeat(50) });
  });

  it('reports a missing blob', async () => {
    await expect(
      readBlob(dir, { $blob: { path: 'blobs/none.json', sha256: 'x', bytes: 1 } }),
    ).rejects.toMatchObject({
      code: 'LEDGER_BLOB_MISSING',
      details: { path: 'blobs/none.json' },
    });
  });
});
