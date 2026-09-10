import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ChipAgentError } from '../errors.js';
import { ToolCallLedger, ledgerFileName } from './ledger.js';
import { withLedger } from './with-ledger.js';

const START = new Date('2026-09-10T10:00:00Z');
const PARENT = '00000000-0000-4000-8000-000000000099';

let dir: string;
let ledger: ToolCallLedger;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ledger-'));
  let n = 0;
  ledger = new ToolCallLedger({
    dir,
    sessionId: 's1',
    clock: () => START,
    idGenerator: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function lines(): Promise<Record<string, unknown>[]> {
  const text = await readFile(path.join(dir, ledgerFileName(START)), 'utf8');
  return text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('withLedger', () => {
  it('records the input and output and returns the output', async () => {
    const handler = withLedger(
      ledger,
      { name: 'add', spendsQuota: false },
      async (input: { a: number; b: number }) => Promise.resolve(input.a + input.b),
    );

    await expect(handler({ a: 2, b: 3 })).resolves.toBe(5);

    expect(await lines()).toEqual([
      expect.objectContaining({
        tool: 'add',
        input: { a: 2, b: 3 },
        output: 5,
        spendsQuota: false,
        sessionId: 's1',
      }),
    ]);
  });

  it('records the error and rethrows the same instance', async () => {
    const failure = new ChipAgentError('BOOM', 'exploded', { details: { at: 1 } });
    const handler = withLedger(ledger, { name: 'explode', spendsQuota: true }, () =>
      Promise.reject(failure),
    );

    await expect(handler(undefined)).rejects.toBe(failure);

    expect(await lines()).toEqual([
      expect.objectContaining({
        tool: 'explode',
        input: null,
        spendsQuota: true,
        error: { name: 'ChipAgentError', code: 'BOOM', message: 'exploded', details: { at: 1 } },
      }),
    ]);
  });

  it('passes the call id to the handler and links a parent id when given', async () => {
    let seen = '';
    const handler = withLedger(
      ledger,
      { name: 'child', spendsQuota: false },
      (_input: null, context) => {
        seen = context.callId;
        return Promise.resolve('ok');
      },
    );

    await handler(null, PARENT);

    const [record] = await lines();
    expect(record?.id).toBe(seen);
    expect(record?.parentId).toBe(PARENT);
  });

  it('omits parentId when none is given', async () => {
    const handler = withLedger(ledger, { name: 'root', spendsQuota: false }, () =>
      Promise.resolve(1),
    );
    await handler(null);

    const [record] = await lines();
    expect(record).not.toHaveProperty('parentId');
  });
});
