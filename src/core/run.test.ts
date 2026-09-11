import { describe, expect, it } from 'vitest';

import { finishedRun, run, runDetails } from '../../test/helpers/core-fixtures.js';
import { expectAccepts, expectRejects } from '../../test/helpers/schema.js';
import { RUN_KINDS, RUN_RESULTS, Run, RunKind, RunResult } from './run.js';

describe('RunKind and RunResult', () => {
  it.each(RUN_KINDS)('accepts the kind %s', (value) => {
    expectAccepts(RunKind, value);
  });

  it.each(RUN_RESULTS)('accepts the result %s', (value) => {
    expectAccepts(RunResult, value);
  });

  it('rejects a kind and a result it does not have', () => {
    expectRejects(RunKind, 'classify');
    expectRejects(RunResult, 'stored');
  });
});

describe('Run', () => {
  it('accepts a run that has started and not finished', () => {
    expectAccepts(Run, run());
    expectAccepts(Run, run({ sessionId: 'f7d0c0a2-1b3c-4d5e-8f90-a1b2c3d4e5f6' }));
  });

  it('accepts a finished run', () => {
    expectAccepts(Run, finishedRun());
    expectAccepts(
      Run,
      finishedRun({
        kind: 'verify',
        result: 'verified',
        details: runDetails({
          verdicts: { confirmed: 30, contradicted: 0, notFound: 0, unchecked: 0 },
        }),
      }),
    );
    expectAccepts(
      Run,
      finishedRun({
        result: 'rejected',
        details: runDetails({
          subtype: 'error_max_turns',
          reason: 'the run stopped at its turn limit without storing a part',
          stored: false,
          toolFailures: ['read_pages'],
          spendDenials: 2,
        }),
      }),
    );
  });

  it.each(['endedAt', 'turns', 'costUsd', 'details'])(
    'refuses a finished run missing %s',
    (field) => {
      const { [field]: _dropped, ...rest } = finishedRun();
      expectRejects(Run, rest, field);
    },
  );

  it.each([
    ['endedAt', { endedAt: '2026-09-10T01:00:00Z' }],
    ['turns', { turns: 3 }],
    ['costUsd', { costUsd: 0.1 }],
    ['details', { details: runDetails() }],
  ])('refuses %s on a run with no result', (field, extra) => {
    expectRejects(Run, run(extra), field);
  });

  it('refuses a run that ended before it started', () => {
    expectRejects(Run, finishedRun({ endedAt: '2026-09-09T23:00:00Z' }), 'endedAt');
  });

  it.each([
    ['an id that is not a uuid', run({ id: 'run-1' })],
    ['a part number with whitespace', run({ mpn: 'TPS 54331' })],
    ['an unversioned prompt', run({ promptVersion: 'extract' })],
    ['an empty model', run({ model: '' })],
    ['an empty session id', run({ sessionId: '' })],
    ['a negative cost', finishedRun({ costUsd: -1 })],
    ['a fractional turn count', finishedRun({ turns: 1.5 })],
    ['an extra key', run({ transcript: [] })],
    ['details with an extra key', finishedRun({ details: runDetails({ notes: 'hello' }) })],
    ['details with a negative count', finishedRun({ details: runDetails({ toolCalls: -1 }) })],
    ['details with an empty reason', finishedRun({ details: runDetails({ reason: '' }) })],
    [
      'verdicts missing a count',
      finishedRun({ details: runDetails({ verdicts: { confirmed: 1 } }) }),
    ],
  ])('rejects %s', (_label, value) => {
    expectRejects(Run, value);
  });

  it('keeps the two ways a run can be unfinished apart in its message', () => {
    const started = Run.safeParse(run({ turns: 2 }));
    const finished = Run.safeParse(finishedRun({ turns: undefined }));
    expect(started.success).toBe(false);
    expect(finished.success).toBe(false);
    expect(started.error?.issues.map((issue) => issue.message)).toContain(
      'turns belongs to a finished run, which needs a result',
    );
    expect(finished.error?.issues.map((issue) => issue.message)).toContain(
      'a finished run must record turns',
    );
  });
});
