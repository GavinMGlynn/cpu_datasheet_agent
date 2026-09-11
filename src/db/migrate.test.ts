import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Db } from './database.js';
import { appliedMigrations, applyMigrations, type Migration } from './migrate.js';
import { MIGRATIONS } from './migrations/index.js';

const clock = (): Date => new Date('2026-09-10T10:00:00Z');

const one: Migration = { id: 1, name: 'one', up: 'CREATE TABLE one (v INTEGER)' };
const two: Migration = { id: 2, name: 'two', up: 'CREATE TABLE two (v INTEGER)' };
const broken: Migration = {
  id: 2,
  name: 'broken',
  up: 'CREATE TABLE ok (v INTEGER); CREATE TABLE ok (v INTEGER)',
};

function tables(db: Db): string[] {
  return db.raw
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
}

let dir: string;
let db: Db;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'migrate-'));
  db = new Db(':memory:');
});

afterEach(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true });
});

describe('applyMigrations', () => {
  it('applies pending migrations in order and records them', () => {
    expect(applyMigrations(db, [one, two], clock)).toEqual([1, 2]);
    expect(tables(db)).toEqual(['one', 'schema_migrations', 'two']);
    expect(appliedMigrations(db)).toEqual([
      { id: 1, name: 'one', appliedAt: '2026-09-10T10:00:00.000Z' },
      { id: 2, name: 'two', appliedAt: '2026-09-10T10:00:00.000Z' },
    ]);
  });

  it('is a no-op when everything is applied, and applies only what is new', () => {
    applyMigrations(db, [one], clock);
    expect(applyMigrations(db, [one], clock)).toEqual([]);
    expect(applyMigrations(db, [one, two], clock)).toEqual([2]);
    expect(applyMigrations(db, [one, two], clock)).toEqual([]);
  });

  it('rolls back a failing migration completely', () => {
    applyMigrations(db, [one], clock);
    expect(() => applyMigrations(db, [one, broken], clock)).toThrow(/migration 2 "broken" failed/);
    try {
      applyMigrations(db, [one, broken], clock);
    } catch (error) {
      expect((error as { code: string }).code).toBe('DB_MIGRATION_FAILED');
    }
    expect(tables(db)).toEqual(['one', 'schema_migrations']);
    expect(appliedMigrations(db).map((row) => row.id)).toEqual([1]);
  });

  it('rejects ids that are not consecutive from 1', () => {
    expect(() => applyMigrations(db, [two])).toThrow(/consecutive/);
    expect(() => applyMigrations(db, [one, { ...two, id: 3 }])).toThrow(/consecutive/);
    expect(() => applyMigrations(db, [{ ...one, id: 1.5 }])).toThrow(/consecutive/);
  });

  it('rejects a database whose recorded migrations are not in the list', () => {
    applyMigrations(db, [one, two], clock);
    expect(() => applyMigrations(db, [one], clock)).toThrow(/not in the migration list/);
    expect(() => applyMigrations(db, [{ ...one, name: 'renamed' }, two], clock)).toThrow(
      /not in the migration list/,
    );
  });

  it('uses the real clock by default', () => {
    const before = Date.now();
    applyMigrations(db, [one]);
    const appliedAt = Date.parse(appliedMigrations(db)[0]?.appliedAt ?? '');
    expect(appliedAt).toBeGreaterThanOrEqual(before - 1000);
  });

  it('defaults to an empty migration list', () => {
    expect(applyMigrations(db)).toEqual([]);
    expect(tables(db)).toEqual(['schema_migrations']);
  });

  it('persists across connections to the same file', () => {
    const file = path.join(dir, 'p.sqlite');
    const first = new Db(file);
    applyMigrations(first, MIGRATIONS, clock);
    first.close();
    const second = new Db(file);
    expect(applyMigrations(second, MIGRATIONS, clock)).toEqual([]);
    expect(appliedMigrations(second).map((row) => row.name)).toEqual(
      MIGRATIONS.map((migration) => migration.name),
    );
    second.close();
  });
});

describe('MIGRATIONS', () => {
  it('counts a run recorded before cache misses were counted as having none', () => {
    // Migrations 1 and 2 are the schema as it was when this row was written.
    applyMigrations(db, MIGRATIONS.slice(0, 2), clock);
    const details = {
      subtype: 'success',
      toolCalls: 3,
      toolFailures: [],
      escalations: 0,
      spendDenials: 0,
      stored: true,
    };
    db.raw
      .prepare<[string]>(
        `INSERT INTO runs (id, mpn, kind, prompt_version, model, started_at, ended_at, turns, cost_usd, result, details_json)
         VALUES ('r1', 'TPS54331DR', 'extract', 'extract.v1', 'claude-opus-5',
                 '2026-09-11T00:00:00Z', '2026-09-11T00:10:00Z', 4, 1.5, 'extracted', ?)`,
      )
      .run(JSON.stringify(details));

    applyMigrations(db, MIGRATIONS, clock);

    const row = db.raw
      .prepare<[string], { details_json: string }>('SELECT details_json FROM runs WHERE id = ?')
      .get('r1');
    expect(JSON.parse(row?.details_json ?? '{}')).toEqual({ ...details, cacheMisses: 0 });
  });

  it('leaves a run that has a count alone, and a run with no details at all', () => {
    applyMigrations(db, MIGRATIONS.slice(0, 2), clock);
    db.raw
      .prepare(
        `INSERT INTO runs (id, mpn, kind, prompt_version, model, started_at)
         VALUES ('open', 'LM5164DDAR', 'extract', 'extract.v1', 'claude-opus-5', '2026-09-11T00:00:00Z')`,
      )
      .run();
    db.raw
      .prepare<[string]>(
        `INSERT INTO runs (id, mpn, kind, prompt_version, model, started_at, ended_at, turns, cost_usd, result, details_json)
         VALUES ('counted', 'LM5164DDAR', 'extract', 'extract.v1', 'claude-opus-5',
                 '2026-09-11T00:00:00Z', '2026-09-11T00:10:00Z', 4, 1.5, 'extracted', ?)`,
      )
      .run(JSON.stringify({ cacheMisses: 2 }));

    applyMigrations(db, MIGRATIONS, clock);

    const rows = db.raw
      .prepare<[], { id: string; details_json: string | null }>(
        'SELECT id, details_json FROM runs ORDER BY id',
      )
      .all();
    expect(rows).toEqual([
      { id: 'counted', details_json: JSON.stringify({ cacheMisses: 2 }) },
      { id: 'open', details_json: null },
    ]);
  });

  it('creates the full schema with its indices and the budget row', () => {
    applyMigrations(db, MIGRATIONS, clock);
    expect(tables(db)).toEqual([
      'classifications',
      'datasheet_mpns',
      'datasheets',
      'escalations',
      'nexar_budget',
      'offers',
      'parameters',
      'parts',
      'price_breaks',
      'runs',
      'schema_migrations',
      'verifications',
    ]);
    const indices = db.raw
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    expect(indices).toEqual([
      'classifications_axis_value',
      'datasheet_mpns_mpn',
      'escalations_open',
      'parameters_key_numeric',
      'parts_category',
      'parts_status',
      'runs_mpn',
      'verifications_part',
    ]);
    expect(
      db.raw
        .prepare<[], { used: number; limit_value: number }>(
          'SELECT used, limit_value FROM nexar_budget',
        )
        .get(),
    ).toEqual({
      used: 0,
      limit_value: 90,
    });
  });
});
