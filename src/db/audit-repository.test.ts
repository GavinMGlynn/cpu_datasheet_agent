import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ValidationError } from '../core/validation-error.js';
import { AuditRepository } from './audit-repository.js';
import type { Db } from './database.js';
import { openDatabase } from './open.js';

let db: Db;
let repo: AuditRepository;

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function event(n: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: uuid(n),
    at: `2026-09-1${String(n)}T00:00:00Z`,
    actor: 'gavin',
    action: 'parameter.correct',
    targetKind: 'parameter',
    targetId: 'TPS54331DR:vinMax',
    reason: 'the ordering table says 28 V',
    before: { value: 30, unit: 'V' },
    after: { value: 28, unit: 'V' },
    ...overrides,
  };
}

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = new AuditRepository(db);
});

afterEach(() => {
  db.close();
});

describe('AuditRepository', () => {
  it('records an event and reads it back unchanged', () => {
    const recorded = repo.record(event(1));
    expect(repo.get(uuid(1))).toStrictEqual(recorded);
  });

  it('keeps a change that created something and one that removed it', () => {
    repo.record(event(1, { before: undefined, action: 'golden.create' }));
    repo.record(event(2, { after: undefined, action: 'cache.purge', targetKind: 'cache' }));
    expect(repo.get(uuid(1))?.before).toBeUndefined();
    expect(repo.get(uuid(2))?.after).toBeUndefined();
  });

  it('validates before it writes, and never coerces', () => {
    expect(() => repo.record(event(1, { reason: '' }))).toThrow(ValidationError);
    expect(() => repo.record(event(1, { targetKind: 'invented' }))).toThrow(ValidationError);
    expect(repo.list()).toStrictEqual([]);
  });

  it('refuses to write the same event twice', () => {
    repo.record(event(1));
    expect(() => repo.record(event(1))).toThrow(
      expect.objectContaining({ code: 'DB_DUPLICATE_AUDIT_EVENT' }),
    );
  });

  it('has nothing to say about an event it does not hold', () => {
    expect(repo.get(uuid(9))).toBeUndefined();
  });

  it('lists most recent first', () => {
    repo.record(event(1));
    repo.record(event(2));
    expect(repo.list().map((one) => one.id)).toStrictEqual([uuid(2), uuid(1)]);
  });

  it('filters by target, action and actor', () => {
    repo.record(event(1));
    repo.record(event(2, { targetKind: 'part', targetId: 'AP62200WU-7', action: 'part.status' }));
    repo.record(event(3, { actor: 'someone else' }));
    expect(repo.list({ targetKind: 'part' })).toHaveLength(1);
    expect(repo.list({ targetId: 'TPS54331DR:vinMax' })).toHaveLength(2);
    expect(repo.list({ action: 'part.status' })).toHaveLength(1);
    expect(repo.list({ actor: 'someone else' })).toHaveLength(1);
    expect(repo.list({ targetKind: 'part', action: 'parameter.correct' })).toStrictEqual([]);
  });

  it('limits how much it returns, and defaults the limit', () => {
    repo.record(event(1));
    repo.record(event(2));
    expect(repo.list({ limit: 1 })).toHaveLength(1);
    expect(repo.list()).toHaveLength(2);
  });
});
