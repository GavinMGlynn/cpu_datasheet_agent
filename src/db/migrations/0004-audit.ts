import type { Migration } from '../migrate.js';

/**
 * The audit trail, added with the web application (M19, D65).
 *
 * Every change a person makes through the site is written here first: what
 * was changed, by whom, why, and what it replaced. Nothing deletes from this
 * table, and nothing updates a row: a correction to a correction is another
 * row.
 */
export const migration: Migration = {
  id: 4,
  name: 'audit',
  up: `
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT
);

CREATE INDEX audit_events_target ON audit_events (target_kind, target_id);
CREATE INDEX audit_events_at ON audit_events (at DESC);
`,
};
