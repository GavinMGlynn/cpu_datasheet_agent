import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ValidationError } from '../core/validation-error.js';
import { LATER, part, verification } from '../../test/helpers/core-fixtures.js';
import type { Db } from './database.js';
import { DbError } from './database.js';
import { openDatabase } from './open.js';
import { PartRepository } from './part-repository.js';
import { VerificationRepository } from './verification-repository.js';

let db: Db;
let repo: VerificationRepository;

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = new VerificationRepository(db);
  new PartRepository(db).upsertPart(part());
});

afterEach(() => {
  db.close();
});

describe('VerificationRepository', () => {
  it('records verdicts and lists them oldest first, keeping history', () => {
    const first = verification();
    const second = verification({ checkedAt: LATER, verdict: 'contradicted', quote: 'differs' });
    expect(repo.record('TPS54331DR', first)).toEqual(first);
    repo.record('TPS54331DR', second);

    expect(repo.list('TPS54331DR')).toEqual([first, second]);
  });

  it('round-trips a not_found verdict without a quote', () => {
    const { quote: _quote, ...notFound } = verification({ verdict: 'not_found' });
    repo.record('TPS54331DR', notFound);
    expect(repo.list('TPS54331DR')).toEqual([notFound]);
  });

  it('returns the latest verdict per parameter', () => {
    repo.record(
      'TPS54331DR',
      verification({ parameterKey: 'vinMax', checkedAt: '2026-09-10T00:00:00Z' }),
    );
    repo.record(
      'TPS54331DR',
      verification({ parameterKey: 'ioutMax', checkedAt: '2026-09-10T00:30:00Z' }),
    );
    repo.record(
      'TPS54331DR',
      verification({
        parameterKey: 'vinMax',
        checkedAt: LATER,
        verdict: 'contradicted',
        quote: 'x',
      }),
    );

    const latest = repo.latestByParameter('TPS54331DR');
    expect([...latest.keys()]).toEqual(['vinMax', 'ioutMax']);
    expect(latest.get('vinMax')?.verdict).toBe('contradicted');
    expect(latest.get('ioutMax')?.verdict).toBe('confirmed');
  });

  it('rejects unknown parts and invalid verdicts', () => {
    expect(() => repo.record('NOPE', verification())).toThrow(DbError);
    expect(() => repo.list('NOPE')).toThrow(DbError);
    try {
      repo.list('NOPE');
    } catch (error) {
      expect((error as DbError).code).toBe('DB_PART_NOT_FOUND');
    }
    expect(() => repo.record('TPS54331DR', verification({ page: 0 }))).toThrow(ValidationError);
    expect(repo.list('TPS54331DR')).toEqual([]);
  });
});
