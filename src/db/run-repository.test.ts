import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ValidationError } from '../core/validation-error.js';
import {
  EARLIER,
  LATER,
  NOW,
  OTHER_UUID,
  UUID,
  run,
  runDetails,
} from '../../test/helpers/core-fixtures.js';
import type { Db } from './database.js';
import { DbError } from './database.js';
import { openDatabase } from './open.js';
import { RunRepository, type RunOutcome } from './run-repository.js';

let db: Db;
let repo: RunRepository;

const outcome: RunOutcome = {
  endedAt: LATER,
  turns: 12,
  costUsd: 0.42,
  result: 'extracted',
  details: runDetails(),
};

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = new RunRepository(db);
});

afterEach(() => {
  db.close();
});

describe('RunRepository.start', () => {
  it('stores a run that has begun and returns it unchanged', () => {
    const started = run();
    expect(repo.start(started)).toEqual(started);
    expect(repo.get(UUID)).toEqual(started);
  });

  it('keeps the session id when the run already has one', () => {
    const started = run({ sessionId: 'session-7' });
    repo.start(started);
    expect(repo.get(UUID)).toEqual(started);
  });

  it('returns undefined for an unknown id', () => {
    expect(repo.get(OTHER_UUID)).toBeUndefined();
  });

  it('refuses a run that is already finished', () => {
    expect(() =>
      repo.start(
        run({
          endedAt: LATER,
          turns: 1,
          costUsd: 0.1,
          result: 'extracted',
          details: runDetails(),
        }),
      ),
    ).toThrow(DbError);
  });

  it('refuses a duplicate id and an invalid run', () => {
    repo.start(run());
    expect(() => repo.start(run())).toThrow(DbError);
    expect(() => repo.start(run({ model: '' }))).toThrow(ValidationError);
  });
});

describe('RunRepository.finish', () => {
  it('completes a run and returns the whole record', () => {
    repo.start(run());

    const finished = repo.finish(UUID, outcome);

    expect(finished).toEqual({ ...run(), ...outcome, details: runDetails() });
    expect(repo.get(UUID)).toEqual(finished);
  });

  it('records the session the harness gave the run', () => {
    repo.start(run());
    expect(repo.finish(UUID, { ...outcome, sessionId: 'session-9' }).sessionId).toBe('session-9');
  });

  it('keeps a session id already on the run when the outcome names none', () => {
    repo.start(run({ sessionId: 'session-1' }));
    expect(repo.finish(UUID, outcome).sessionId).toBe('session-1');
  });

  it('refuses an unknown run, a second ending, and details of the wrong shape', () => {
    expect(() => repo.finish(OTHER_UUID, outcome)).toThrow(DbError);
    repo.start(run());
    repo.finish(UUID, outcome);
    expect(() => repo.finish(UUID, outcome)).toThrow(DbError);

    repo.start(run({ id: OTHER_UUID }));
    expect(() => repo.finish(OTHER_UUID, { ...outcome, details: { subtype: 'success' } })).toThrow(
      ValidationError,
    );
  });

  it('refuses an ending that contradicts the start', () => {
    repo.start(run());
    expect(() => repo.finish(UUID, { ...outcome, endedAt: EARLIER })).toThrow(ValidationError);
  });
});

describe('RunRepository.list', () => {
  const second = '1f0b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d';

  beforeEach(() => {
    repo.start(run());
    repo.finish(UUID, outcome);
    repo.start(run({ id: OTHER_UUID, mpn: 'LM5164DDAR', startedAt: LATER }));
    repo.start(
      run({ id: second, mpn: 'TPS54331DR', promptVersion: 'extract.v2', startedAt: EARLIER }),
    );
  });

  it('returns every run newest first', () => {
    expect(repo.list().map((one) => one.id)).toEqual([OTHER_UUID, UUID, second]);
  });

  it('filters by part, kind, prompt version, result and whether the run ended', () => {
    expect(repo.list({ mpn: 'LM5164DDAR' }).map((one) => one.id)).toEqual([OTHER_UUID]);
    expect(repo.list({ kind: 'extract' })).toHaveLength(3);
    expect(repo.list({ promptVersion: 'extract.v2' }).map((one) => one.id)).toEqual([second]);
    expect(repo.list({ result: 'extracted' }).map((one) => one.id)).toEqual([UUID]);
    expect(repo.list({ result: 'rejected' })).toEqual([]);
    expect(repo.list({ finished: true }).map((one) => one.id)).toEqual([UUID]);
    expect(repo.list({ finished: false }).map((one) => one.id)).toEqual([OTHER_UUID, second]);
  });

  it('honours a limit', () => {
    expect(repo.list({ limit: 1 }).map((one) => one.id)).toEqual([OTHER_UUID]);
  });
});

describe('RunRepository.latestFinished', () => {
  it('finds the last run that reached a conclusion for one part and prompt version', () => {
    repo.start(run());
    repo.finish(UUID, outcome);
    repo.start(run({ id: OTHER_UUID, startedAt: LATER }));

    expect(repo.latestFinished('TPS54331DR', 'extract', 'extract.v1')?.id).toBe(UUID);
    expect(repo.latestFinished('TPS54331DR', 'extract', 'extract.v2')).toBeUndefined();
    expect(repo.latestFinished('LM5164DDAR', 'extract', 'extract.v1')).toBeUndefined();
  });

  it('prefers the most recent of several finished runs', () => {
    repo.start(run({ startedAt: EARLIER }));
    repo.finish(UUID, { ...outcome, endedAt: NOW, result: 'rejected' });
    repo.start(run({ id: OTHER_UUID, startedAt: NOW }));
    repo.finish(OTHER_UUID, outcome);

    expect(repo.latestFinished('TPS54331DR', 'extract', 'extract.v1')?.id).toBe(OTHER_UUID);
  });
});
