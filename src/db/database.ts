import Database from 'better-sqlite3';

import { ChipAgentError } from '../errors.js';

export class DbError extends ChipAgentError {}

export type SqliteDatabase = Database.Database;

export interface OpenOptions {
  /** Milliseconds to wait for a lock held by another connection. Default 5000. */
  readonly busyTimeoutMs?: number;
}

/**
 * Thin wrapper over one SQLite connection. Opens with WAL journaling (file
 * databases), foreign keys on, and a busy timeout. `:memory:` is supported
 * for tests. Migrations are applied separately by `applyMigrations`.
 */
export class Db {
  readonly raw: SqliteDatabase;
  readonly path: string;

  constructor(path: string, options: OpenOptions = {}) {
    this.path = path;
    try {
      this.raw = new Database(path, { timeout: options.busyTimeoutMs ?? 5000 });
    } catch (error) {
      throw new DbError('DB_OPEN_FAILED', `cannot open database ${path}`, {
        cause: error,
        details: { path },
      });
    }
    if (path !== ':memory:') {
      this.raw.pragma('journal_mode = WAL');
    }
    this.raw.pragma('foreign_keys = ON');
  }

  get inMemory(): boolean {
    return this.path === ':memory:';
  }

  /** Runs `fn` in a deferred transaction; rolls back if it throws. */
  transaction<T>(fn: () => T): T {
    return this.raw.transaction(fn)();
  }

  /** Runs `fn` in an immediate transaction, taking the write lock up front. */
  immediateTransaction<T>(fn: () => T): T {
    return this.raw.transaction(fn).immediate();
  }

  pragma(name: string): unknown {
    return this.raw.pragma(name, { simple: true });
  }

  close(): void {
    this.raw.close();
  }
}

/** Unwraps a row that must exist (just written, or guarded by a foreign key). */
export function requireRow<T>(row: T | undefined, what: string): T {
  if (row === undefined) {
    throw new DbError('DB_ROW_MISSING', `expected ${what} to exist`, { details: { what } });
  }
  return row;
}
