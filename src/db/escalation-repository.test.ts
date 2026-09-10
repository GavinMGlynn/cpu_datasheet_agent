import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ValidationError } from '../core/validation-error.js';
import { EARLIER, LATER, OTHER_UUID, UUID, escalation } from '../../test/helpers/core-fixtures.js';
import type { Db } from './database.js';
import { DbError } from './database.js';
import { EscalationRepository } from './escalation-repository.js';
import { openDatabase } from './open.js';

let db: Db;
let repo: EscalationRepository;

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = new EscalationRepository(db);
});

afterEach(() => {
  db.close();
});

describe('EscalationRepository', () => {
  it('creates and returns escalations unchanged, with and without options', () => {
    const plain = escalation();
    const withOptions = escalation({ id: OTHER_UUID, options: ['28 V', '30 V'], createdAt: LATER });
    expect(repo.create(plain)).toEqual(plain);
    expect(repo.create(withOptions)).toEqual(withOptions);
    expect(repo.get(UUID)).toEqual(plain);
    expect(repo.get(OTHER_UUID)).toEqual(withOptions);
  });

  it('returns undefined for an unknown id', () => {
    expect(repo.get(OTHER_UUID)).toBeUndefined();
  });

  it('rejects duplicates and invalid escalations', () => {
    repo.create(escalation());
    expect(() => repo.create(escalation())).toThrow(DbError);
    try {
      repo.create(escalation());
    } catch (error) {
      expect((error as DbError).code).toBe('DB_DUPLICATE_ESCALATION');
    }
    expect(() => repo.create(escalation({ id: 'x' }))).toThrow(ValidationError);
    expect(repo.list()).toHaveLength(1);
  });

  it('lists with filters, oldest first', () => {
    repo.create(
      escalation({ id: OTHER_UUID, mpn: 'MP1584EN', kind: 'ambiguous_mpn', createdAt: EARLIER }),
    );
    repo.create(escalation());
    repo.resolve(UUID, { answer: '28 V', resolvedAt: LATER, by: 'gavin' });

    expect(repo.list().map((found) => found.id)).toEqual([OTHER_UUID, UUID]);
    expect(repo.list({ mpn: 'TPS54331DR' }).map((found) => found.id)).toEqual([UUID]);
    expect(repo.list({ kind: 'ambiguous_mpn' }).map((found) => found.id)).toEqual([OTHER_UUID]);
    expect(repo.list({ resolved: true }).map((found) => found.id)).toEqual([UUID]);
    expect(repo.list({ resolved: false }).map((found) => found.id)).toEqual([OTHER_UUID]);
    expect(repo.list({ mpn: 'MP1584EN', kind: 'conflict' })).toEqual([]);
    expect(repo.listOpen().map((found) => found.id)).toEqual([OTHER_UUID]);
    expect(repo.listOpen('MP1584EN').map((found) => found.id)).toEqual([OTHER_UUID]);
    expect(repo.listOpen('TPS54331DR')).toEqual([]);
  });

  it('resolves once and stores the resolution', () => {
    repo.create(escalation());
    const resolution = { answer: '28 V per page 4', resolvedAt: LATER, by: 'gavin' };
    const resolved = repo.resolve(UUID, resolution);
    expect(resolved.resolution).toEqual(resolution);
    expect(repo.get(UUID)?.resolution).toEqual(resolution);

    expect(() => repo.resolve(UUID, resolution)).toThrow(DbError);
    try {
      repo.resolve(UUID, resolution);
    } catch (error) {
      expect((error as DbError).code).toBe('DB_ESCALATION_ALREADY_RESOLVED');
    }
  });

  it('rejects resolving an unknown escalation or with an invalid resolution', () => {
    expect(() => repo.resolve(OTHER_UUID, { answer: 'x', resolvedAt: LATER, by: 'g' })).toThrow(
      DbError,
    );
    repo.create(escalation());
    expect(() => repo.resolve(UUID, { answer: 'x', resolvedAt: EARLIER, by: 'g' })).toThrow(
      ValidationError,
    );
    expect(() => repo.resolve(UUID, { answer: '' })).toThrow(ValidationError);
    expect(repo.get(UUID)?.resolution).toBeUndefined();
  });
});

describe('EscalationRepository with a resolution supplied at creation', () => {
  it('stores and returns the resolution', () => {
    const db2 = openDatabase(':memory:');
    const repo2 = new EscalationRepository(db2);
    const resolved = escalation({
      resolution: { answer: 'decided offline', resolvedAt: LATER, by: 'gavin' },
    });
    expect(repo2.create(resolved)).toEqual(resolved);
    expect(repo2.get(UUID)).toEqual(resolved);
    expect(repo2.listOpen()).toEqual([]);
    db2.close();
  });
});
