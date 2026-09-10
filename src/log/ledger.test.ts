import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ValidationError } from '../core/validation-error.js';
import { ChipAgentError } from '../errors.js';
import {
  DEFAULT_SIDECAR_THRESHOLD_BYTES,
  LedgerError,
  ToolCallLedger,
  ledgerFileName,
  toErrorJson,
  type LedgerOptions,
} from './ledger.js';

const T0 = Date.parse('2026-09-10T10:00:00Z');

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

let dir: string;
let now: number;
let ids: number;

function make(overrides: Partial<LedgerOptions> = {}): ToolCallLedger {
  return new ToolCallLedger({
    dir,
    sessionId: 'session-1',
    clock: () => new Date(now),
    idGenerator: () => uuid(++ids),
    ...overrides,
  });
}

async function readLines(file = ledgerFileName(new Date(T0))): Promise<Record<string, unknown>[]> {
  const text = await readFile(path.join(dir, file), 'utf8');
  expect(text.endsWith('\n')).toBe(true);
  return text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), 'ledger-')), 'ledger');
  now = T0;
  ids = 0;
});

afterEach(async () => {
  await rm(path.dirname(dir), { recursive: true, force: true });
});

describe('ledgerFileName', () => {
  it('uses the UTC date', () => {
    expect(ledgerFileName(new Date('2026-09-10T23:59:59Z'))).toBe('2026-09-10.jsonl');
    expect(ledgerFileName(new Date('2026-09-11T00:00:00Z'))).toBe('2026-09-11.jsonl');
  });
});

describe('toErrorJson', () => {
  it('serialises ChipAgentError, plain Error, and non-error values', () => {
    expect(toErrorJson(new ChipAgentError('C', 'm', { details: { k: 1 } }))).toEqual({
      name: 'ChipAgentError',
      code: 'C',
      message: 'm',
      details: { k: 1 },
    });
    expect(toErrorJson(new RangeError('out'))).toEqual({
      name: 'RangeError',
      code: 'UNKNOWN',
      message: 'out',
      details: {},
    });
    expect(toErrorJson('just a string')).toEqual({
      name: 'NonError',
      code: 'UNKNOWN',
      message: 'just a string',
      details: {},
    });
    expect(toErrorJson(undefined)).toEqual({
      name: 'NonError',
      code: 'UNKNOWN',
      message: 'undefined',
      details: {},
    });
  });
});

describe('ToolCallLedger', () => {
  it('writes one validated JSON line per completed call into the day file', async () => {
    const ledger = make();
    const id = ledger.begin('read_pages', { pages: [1, 2] }, { spendsQuota: false });
    expect(ledger.pendingCount).toBe(1);
    now += 250;

    const record = await ledger.end(id, { output: { text: 'ok' } });

    expect(ledger.pendingCount).toBe(0);
    expect(ledger.sessionId).toBe('session-1');
    expect(record).toEqual({
      id: uuid(1),
      sessionId: 'session-1',
      tool: 'read_pages',
      input: { pages: [1, 2] },
      output: { text: 'ok' },
      startedAt: '2026-09-10T10:00:00.000Z',
      durationMs: 250,
      spendsQuota: false,
    });
    expect(await readLines()).toEqual([record]);
  });

  it('creates the directory on first write', async () => {
    await expect(stat(dir)).rejects.toMatchObject({ code: 'ENOENT' });
    const ledger = make();
    await ledger.end(ledger.begin('t', null, { spendsQuota: false }), { output: 1 });
    expect((await stat(dir)).isDirectory()).toBe(true);
  });

  it('includes parentId only when given', async () => {
    const ledger = make();
    const root = ledger.begin('root', null, { spendsQuota: false });
    const child = ledger.begin('child', null, { spendsQuota: false, parentId: root });
    await ledger.end(child, { output: null });
    await ledger.end(root, { output: null });

    const [first, second] = await readLines();
    expect(first?.parentId).toBe(uuid(1));
    expect(second).not.toHaveProperty('parentId');
  });

  it('records errors of every kind and never an output alongside them', async () => {
    const ledger = make();
    await ledger.end(ledger.begin('a', null, { spendsQuota: true }), {
      error: new ChipAgentError('E1', 'first', { details: { x: 1 } }),
    });
    await ledger.end(ledger.begin('b', null, { spendsQuota: false }), {
      error: new Error('second'),
    });
    await ledger.end(ledger.begin('c', null, { spendsQuota: false }), { error: 42 });

    const records = await readLines();
    expect(records.map((record) => record.error)).toEqual([
      { name: 'ChipAgentError', code: 'E1', message: 'first', details: { x: 1 } },
      { name: 'Error', code: 'UNKNOWN', message: 'second', details: {} },
      { name: 'NonError', code: 'UNKNOWN', message: '42', details: {} },
    ]);
    expect(records.every((record) => !('output' in record))).toBe(true);
    expect(records[0]?.spendsQuota).toBe(true);
  });

  it('rejects ending an unknown call or ending a call twice', async () => {
    const ledger = make();
    await expect(ledger.end('nope', { output: 1 })).rejects.toMatchObject({
      code: 'LEDGER_UNKNOWN_CALL',
      details: { id: 'nope' },
    });
    const id = ledger.begin('t', null, { spendsQuota: false });
    await ledger.end(id, { output: 1 });
    await expect(ledger.end(id, { output: 2 })).rejects.toBeInstanceOf(LedgerError);
  });

  it('clamps a negative duration to zero', async () => {
    const ledger = make();
    const id = ledger.begin('t', null, { spendsQuota: false });
    now -= 500;
    expect((await ledger.end(id, { output: null })).durationMs).toBe(0);

    now = T0;
    const second = ledger.begin('t', null, { spendsQuota: false });
    now += 13;
    expect((await ledger.end(second, { output: null })).durationMs).toBe(13);
  });

  it('stores undefined input and output as null', async () => {
    const ledger = make();
    const record = await ledger.end(ledger.begin('t', undefined, { spendsQuota: false }), {
      output: undefined,
    });
    expect(record.input).toBeNull();
    expect(record.output).toBeNull();
  });

  it('applies the redactor to input, output, and error', async () => {
    const ledger = make({
      redact: (value) => JSON.parse(JSON.stringify(value).replaceAll('secret', '[x]')) as unknown,
    });
    const record = await ledger.end(
      ledger.begin('t', { key: 'secret-1' }, { spendsQuota: false }),
      {
        output: { echo: 'secret-2' },
      },
    );
    expect(record.input).toEqual({ key: '[x]-1' });
    expect(record.output).toEqual({ echo: '[x]-2' });

    const failed = await ledger.end(ledger.begin('t', null, { spendsQuota: false }), {
      error: new Error('secret-3'),
    });
    expect(failed.error?.message).toBe('[x]-3');
  });

  it('rejects an output that is not JSON before touching the disk', async () => {
    const ledger = make();
    const id = ledger.begin('t', null, { spendsQuota: false });
    await expect(ledger.end(id, { output: { big: 10n } })).rejects.toBeInstanceOf(ValidationError);
    expect(ledger.pendingCount).toBe(0);
    await expect(stat(dir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('moves oversized outputs to a blob file and stores a reference', async () => {
    const ledger = make({ sidecarThresholdBytes: 32 });
    const big = { text: 'x'.repeat(100) };
    const json = JSON.stringify(big);
    const sha256 = createHash('sha256').update(json).digest('hex');

    const record = await ledger.end(ledger.begin('t', null, { spendsQuota: false }), {
      output: big,
    });

    expect(record.output).toEqual({
      $blob: { path: path.join('blobs', `${sha256}.json`), sha256, bytes: json.length },
    });
    expect(await readFile(path.join(dir, 'blobs', `${sha256}.json`), 'utf8')).toBe(json);
    expect((await readLines())[0]?.output).toEqual(record.output);
  });

  it('keeps outputs at or under the threshold inline', async () => {
    const ledger = make({ sidecarThresholdBytes: 13 });
    const record = await ledger.end(ledger.begin('t', null, { spendsQuota: false }), {
      output: { a: 'bcdef' },
    });
    expect(record.output).toEqual({ a: 'bcdef' });
    expect(DEFAULT_SIDECAR_THRESHOLD_BYTES).toBe(65536);
    await expect(readdir(path.join(dir, 'blobs'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('serialises concurrent writes so lines never interleave', async () => {
    const ledger = make();
    const ids = Array.from({ length: 50 }, (_, index) =>
      ledger.begin('t', { index }, { spendsQuota: false }),
    );

    await Promise.all(ids.map((id, index) => ledger.end(id, { output: 'v'.repeat(500 + index) })));
    await ledger.flush();

    const records = await readLines();
    expect(records).toHaveLength(50);
    expect(new Set(records.map((record) => record.id)).size).toBe(50);
  });

  it('rolls over to a new file when the start time crosses midnight UTC', async () => {
    const ledger = make();
    const before = ledger.begin('t', null, { spendsQuota: false });
    now = Date.parse('2026-09-11T00:00:00.001Z');
    const after = ledger.begin('t', null, { spendsQuota: false });
    await ledger.end(before, { output: 1 });
    await ledger.end(after, { output: 2 });

    expect((await readLines('2026-09-10.jsonl')).map((record) => record.output)).toEqual([1]);
    expect((await readLines('2026-09-11.jsonl')).map((record) => record.output)).toEqual([2]);
  });

  it('surfaces a write failure to the caller and keeps accepting later writes', async () => {
    const blocker = path.dirname(dir);
    await rm(blocker, { recursive: true, force: true });
    await writeFile(blocker, 'not a directory', 'utf8');
    const ledger = make();

    await expect(
      ledger.end(ledger.begin('t', null, { spendsQuota: false }), { output: 1 }),
    ).rejects.toMatchObject({
      code: 'ENOTDIR',
    });

    await rm(blocker, { force: true });
    await expect(
      ledger.end(ledger.begin('t', null, { spendsQuota: false }), { output: 2 }),
    ).resolves.toMatchObject({
      output: 2,
    });
    expect((await readLines()).map((record) => record.output)).toEqual([2]);
  });

  it('uses random UUIDs and the real clock by default', async () => {
    const before = Date.now();
    const ledger = new ToolCallLedger({ dir, sessionId: 's' });
    const record = await ledger.end(ledger.begin('t', null, { spendsQuota: false }), {
      output: null,
    });
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(record.startedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(record.startedAt)).toBeLessThanOrEqual(Date.now() + 1000);
  });
});
