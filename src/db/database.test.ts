import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Db, DbError, requireRow } from './database.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'db-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('Db', () => {
  it('opens an in-memory database with foreign keys on', () => {
    const db = new Db(':memory:');
    expect(db.inMemory).toBe(true);
    expect(db.pragma('foreign_keys')).toBe(1);
    expect(db.pragma('journal_mode')).toBe('memory');
    db.close();
  });

  it('opens a file database in WAL mode with the busy timeout', () => {
    const db = new Db(path.join(dir, 'a.sqlite'), { busyTimeoutMs: 123 });
    expect(db.inMemory).toBe(false);
    expect(db.pragma('journal_mode')).toBe('wal');
    expect(db.pragma('foreign_keys')).toBe(1);
    expect(db.raw.open).toBe(true);
    db.close();
    expect(db.raw.open).toBe(false);
  });

  it('wraps an open failure', () => {
    expect(() => new Db(path.join(dir, 'missing', 'nested', 'x.sqlite'))).toThrow(DbError);
    try {
      new Db(path.join(dir, 'missing', 'nested', 'x.sqlite'));
    } catch (error) {
      expect((error as DbError).code).toBe('DB_OPEN_FAILED');
    }
  });

  it('rolls back a deferred transaction when the function throws', () => {
    const db = new Db(':memory:');
    db.raw.exec('CREATE TABLE t (v INTEGER)');
    expect(() =>
      db.transaction(() => {
        db.raw.prepare('INSERT INTO t (v) VALUES (1)').run();
        throw new Error('abort');
      }),
    ).toThrow('abort');
    expect(db.raw.prepare<[], { n: number }>('SELECT count(*) AS n FROM t').get()?.n).toBe(0);
    expect(db.transaction(() => 42)).toBe(42);
    db.close();
  });

  it('runs immediate transactions and returns their value', () => {
    const db = new Db(':memory:');
    db.raw.exec('CREATE TABLE t (v INTEGER)');
    const result = db.immediateTransaction(() => {
      db.raw.prepare('INSERT INTO t (v) VALUES (7)').run();
      return 'done';
    });
    expect(result).toBe('done');
    expect(db.raw.prepare<[], { v: number }>('SELECT v FROM t').get()?.v).toBe(7);
    db.close();
  });
});

describe('requireRow', () => {
  it('returns the row or throws DB_ROW_MISSING', () => {
    expect(requireRow({ id: 1 }, 'part')).toEqual({ id: 1 });
    expect(() => {
      requireRow(undefined, 'part');
    }).toThrow(DbError);
    try {
      requireRow(undefined, 'part');
    } catch (error) {
      expect((error as DbError).code).toBe('DB_ROW_MISSING');
      expect((error as DbError).details).toEqual({ what: 'part' });
    }
  });
});
