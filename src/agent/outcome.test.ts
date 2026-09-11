import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ToolCallLedger, ledgerFileName, type MalformedLine } from '../log/index.js';
import { runOutcomeOf, summariseCalls, type ResultFacts } from './outcome.js';

const PARENT = '3f5a1c2e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const OTHER = '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';

let dir: string;
let ledger: ToolCallLedger;
let malformed: MalformedLine[];

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'outcome-'));
  ledger = new ToolCallLedger({ dir, sessionId: 'run-session' });
  malformed = [];
});

afterEach(async () => {
  await ledger.flush();
  await rm(dir, { recursive: true, force: true });
});

function note(one: MalformedLine): void {
  malformed.push(one);
}

async function record(
  tool: string,
  outcome: { output?: unknown; error?: unknown },
  parentId = PARENT,
): Promise<void> {
  const id = ledger.begin(tool, {}, { spendsQuota: false, parentId });
  await ledger.end(
    id,
    'error' in outcome ? { error: outcome.error } : { output: outcome.output ?? null },
  );
}

describe('summariseCalls', () => {
  it('counts nothing for a run that called nothing', async () => {
    expect(await summariseCalls(ledger, PARENT, note)).toEqual({
      toolCalls: 0,
      toolFailures: [],
      spendDenials: 0,
      stored: false,
    });
  });

  it('counts this run’s calls, its failures, its refusals and whether it stored', async () => {
    await record('spend_gate', { output: { decision: 'allow' } });
    await record('spend_gate', { output: { decision: 'deny' } });
    await record('spend_gate', { output: 'not an object' });
    await record('read_pages', { output: { pages: [] } });
    await record('read_pages', { error: new Error('no such page') });
    await record('upsert_part', { output: { part: {} } });

    expect(await summariseCalls(ledger, PARENT, note)).toEqual({
      toolCalls: 3,
      toolFailures: ['read_pages'],
      spendDenials: 1,
      stored: true,
    });
  });

  it('ignores calls belonging to another run', async () => {
    await record('upsert_part', { output: {} }, OTHER);

    expect(await summariseCalls(ledger, PARENT, note)).toEqual({
      toolCalls: 0,
      toolFailures: [],
      spendDenials: 0,
      stored: false,
    });
  });

  it('does not count an upsert_part that failed as a part stored', async () => {
    await record('upsert_part', { error: new Error('vinMax must be greater than vinMin') });

    expect(await summariseCalls(ledger, PARENT, note)).toMatchObject({
      stored: false,
      toolFailures: ['upsert_part'],
    });
  });

  it('reports a line it cannot read rather than counting it', async () => {
    await record('read_pages', { output: {} });
    await writeFile(path.join(dir, ledgerFileName(new Date())), 'not json\n', { flag: 'a' });

    expect((await summariseCalls(ledger, PARENT, note)).toolCalls).toBe(1);
    expect(malformed).toHaveLength(1);
  });
});

describe('runOutcomeOf', () => {
  const facts = (overrides: Partial<ResultFacts> = {}): ResultFacts => ({
    subtype: 'success',
    isError: false,
    stored: true,
    escalations: 0,
    message: 'stored TPS54331DR',
    ...overrides,
  });

  it('calls a clean run that stored a part extracted', () => {
    expect(runOutcomeOf(facts())).toEqual({ result: 'extracted' });
  });

  it('calls a run that left a question needs_human, stored or not', () => {
    expect(runOutcomeOf(facts({ stored: false, escalations: 1 }))).toEqual({
      result: 'needs_human',
    });
    expect(runOutcomeOf(facts({ subtype: 'error_max_turns', escalations: 2 }))).toEqual({
      result: 'needs_human',
    });
  });

  it('rejects a run that stopped early, and says how', () => {
    const outcome = runOutcomeOf(
      facts({ subtype: 'error_max_turns', stored: false, message: 'turn limit' }),
    );

    expect(outcome.result).toBe('rejected');
    expect(outcome.reason).toBe('the run ended as error_max_turns: turn limit');
  });

  it('rejects a run whose last turn was an API error', () => {
    expect(runOutcomeOf(facts({ isError: true, message: 'overloaded' })).reason).toBe(
      'the run ended in an error: overloaded',
    );
  });

  it('rejects a run that did neither thing it was for', () => {
    expect(runOutcomeOf(facts({ stored: false })).reason).toBe(
      'the run finished without storing a part or raising a question',
    );
  });

  it('keeps the reason readable', () => {
    const long = runOutcomeOf(
      facts({ subtype: 'no_result', stored: false, message: 'x'.repeat(600) }),
    );
    const empty = runOutcomeOf(facts({ subtype: 'no_result', stored: false, message: '  ' }));

    expect(long.reason).toHaveLength('the run ended as no_result: '.length + 501);
    expect(empty.reason).toBe('the run ended as no_result: no reason given');
  });
});
