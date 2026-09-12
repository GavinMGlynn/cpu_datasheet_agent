import type { Migration } from '../../db/migrate.js';

/**
 * Accounts and sessions, in a database of their own (M20, D75).
 *
 * Separate from the parts store on purpose: a snapshot, an evaluation copy
 * and a backup of the catalogue all touch that file, and none of them should
 * be able to carry a password hash with them.
 *
 * A session row holds the SHA-256 of the cookie rather than the cookie, so a
 * copy of this database cannot be replayed against the site.
 */
export const migration: Migration = {
  id: 1,
  name: 'accounts',
  up: `
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'admin')),
  password_hash TEXT,
  issuer TEXT,
  subject TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  disabled_at TEXT
);

CREATE UNIQUE INDEX accounts_identity ON accounts (issuer, subject)
  WHERE issuer IS NOT NULL AND subject IS NOT NULL;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT,
  address TEXT
);

CREATE INDEX sessions_account ON sessions (account_id);
CREATE INDEX sessions_expires ON sessions (expires_at);
`,
};
