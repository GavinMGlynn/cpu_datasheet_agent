import type { Db } from './database.js';
import { DbError } from './database.js';

export interface Migration {
  /** Strictly increasing, starting at 1. */
  readonly id: number;
  readonly name: string;
  /** SQL statements applied in one transaction. */
  readonly up: string;
}

export interface AppliedMigration {
  readonly id: number;
  readonly name: string;
  readonly appliedAt: string;
}

interface MigrationRow {
  id: number;
  name: string;
  applied_at: string;
}

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`;

function assertOrdered(migrations: readonly Migration[]): void {
  let previous = 0;
  for (const migration of migrations) {
    if (!Number.isInteger(migration.id) || migration.id !== previous + 1) {
      throw new DbError(
        'DB_MIGRATION_ORDER',
        `migration ids must be consecutive from 1; found ${String(migration.id)} after ${String(previous)}`,
        {
          details: { id: migration.id, previous },
        },
      );
    }
    previous = migration.id;
  }
}

/** Migrations recorded in the database, in order. */
export function appliedMigrations(db: Db): readonly AppliedMigration[] {
  db.raw.exec(CREATE_TABLE);
  const rows = db.raw
    .prepare<[], MigrationRow>('SELECT id, name, applied_at FROM schema_migrations ORDER BY id')
    .all();
  return rows.map((row) => ({ id: row.id, name: row.name, appliedAt: row.applied_at }));
}

/**
 * Applies every migration not yet recorded, each in its own transaction, so
 * a failing migration leaves the schema exactly as it was. Re-running is a
 * no-op. Returns the ids applied by this call.
 */
export function applyMigrations(
  db: Db,
  migrations: readonly Migration[] = [],
  clock: () => Date = (): Date => new Date(),
): readonly number[] {
  assertOrdered(migrations);
  const applied = new Map(appliedMigrations(db).map((row) => [row.id, row.name]));
  for (const [id, name] of applied) {
    const expected = migrations.find((migration) => migration.id === id);
    if (expected?.name !== name) {
      throw new DbError(
        'DB_MIGRATION_MISMATCH',
        `database has migration ${String(id)} "${name}" which is not in the migration list`,
        {
          details: { id, name },
        },
      );
    }
  }
  const insert = db.raw.prepare<[number, string, string]>(
    'INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)',
  );
  const done: number[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      continue;
    }
    try {
      db.transaction(() => {
        db.raw.exec(migration.up);
        insert.run(migration.id, migration.name, clock().toISOString());
      });
    } catch (error) {
      throw new DbError(
        'DB_MIGRATION_FAILED',
        `migration ${String(migration.id)} "${migration.name}" failed and was rolled back`,
        {
          cause: error,
          details: { id: migration.id, name: migration.name },
        },
      );
    }
    done.push(migration.id);
  }
  return done;
}
