import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { Account, Role, Username, type PublicAccount } from './account.js';
import { Db, DbError, type OpenOptions } from '../db/database.js';
import { applyMigrations } from '../db/migrate.js';
import { AUTH_MIGRATIONS } from './migrations/index.js';
import { parseOrThrow } from '../core/validation-error.js';
import { required } from '../util/present.js';

/**
 * Where accounts and sessions live.
 *
 * Its own file, opened once by the server. Nothing else in this project
 * touches it: the parts store is copied, snapshotted and shipped around, and
 * a password hash has no business travelling with any of that (D75).
 */

export function openAuthDatabase(file: string, options: OpenOptions = {}): Db {
  if (file !== ':memory:') {
    mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new Db(file, options);
  applyMigrations(db, AUTH_MIGRATIONS);
  return db;
}

interface AccountRow {
  id: string;
  username: string;
  display_name: string;
  role: string;
  password_hash: string | null;
  issuer: string | null;
  subject: string | null;
  created_at: string;
  updated_at: string;
  disabled_at: string | null;
}

const COLUMNS =
  'id, username, display_name, role, password_hash, issuer, subject, created_at, updated_at, disabled_at';

function hydrate(row: AccountRow): Account {
  return parseOrThrow(
    Account,
    {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      hasPassword: row.password_hash !== null,
      ...(row.issuer === null ? {} : { issuer: row.issuer }),
      ...(row.subject === null ? {} : { subject: row.subject }),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(row.disabled_at === null ? {} : { disabledAt: row.disabled_at }),
    },
    `stored Account ${row.username}`,
  );
}

export interface NewAccount {
  readonly username: string;
  readonly displayName?: string;
  readonly role: Role;
  /** Already hashed. This class never sees a password. */
  readonly passwordHash?: string;
  readonly issuer?: string;
  readonly subject?: string;
}

export interface SessionRecord {
  readonly id: string;
  readonly accountId: string;
  readonly csrf: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly expiresAt: string;
  readonly userAgent?: string;
  readonly address?: string;
}

interface SessionRow {
  id: string;
  account_id: string;
  csrf: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  user_agent: string | null;
  address: string | null;
}

function hydrateSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    csrf: row.csrf,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    ...(row.user_agent === null ? {} : { userAgent: row.user_agent }),
    ...(row.address === null ? {} : { address: row.address }),
  };
}

/**
 * Accounts, and the one query that returns a password hash.
 *
 * `passwordHash` is deliberately not part of `Account`: a hash leaves this
 * class only through {@link AccountRepository.passwordHash}, which the
 * sign-in path calls and nothing else does.
 */
export class AccountRepository {
  constructor(private readonly db: Db) {}

  create(account: NewAccount, now: string = new Date().toISOString()): Account {
    const username = parseOrThrow(Username, account.username, 'username');
    const existing = this.byUsername(username);
    if (existing !== undefined) {
      throw new DbError('AUTH_ACCOUNT_EXISTS', `there is already an account called ${username}`, {
        details: { username },
      });
    }
    const row: AccountRow = {
      id: randomUUID(),
      username,
      display_name: account.displayName ?? username,
      role: parseOrThrow(Role, account.role, 'role'),
      password_hash: account.passwordHash ?? null,
      issuer: account.issuer ?? null,
      subject: account.subject ?? null,
      created_at: now,
      updated_at: now,
      disabled_at: null,
    };
    this.db.raw
      .prepare(
        `INSERT INTO accounts (${COLUMNS})
         VALUES (@id, @username, @display_name, @role, @password_hash, @issuer, @subject,
                 @created_at, @updated_at, @disabled_at)`,
      )
      .run(row);
    return hydrate(row);
  }

  byUsername(username: string): Account | undefined {
    const row = this.db.raw
      .prepare<[string], AccountRow>(`SELECT ${COLUMNS} FROM accounts WHERE username = ?`)
      .get(username.trim().toLowerCase());
    return row === undefined ? undefined : hydrate(row);
  }

  byId(id: string): Account | undefined {
    const row = this.db.raw
      .prepare<[string], AccountRow>(`SELECT ${COLUMNS} FROM accounts WHERE id = ?`)
      .get(id);
    return row === undefined ? undefined : hydrate(row);
  }

  /** The account an identity provider's subject belongs to, if any. */
  byIdentity(issuer: string, subject: string): Account | undefined {
    const row = this.db.raw
      .prepare<[string, string], AccountRow>(
        `SELECT ${COLUMNS} FROM accounts WHERE issuer = ? AND subject = ?`,
      )
      .get(issuer, subject);
    return row === undefined ? undefined : hydrate(row);
  }

  list(): readonly Account[] {
    return this.db.raw
      .prepare<[], AccountRow>(`SELECT ${COLUMNS} FROM accounts ORDER BY username`)
      .all()
      .map(hydrate);
  }

  count(): number {
    return required(
      this.db.raw.prepare<[], { total: number }>('SELECT COUNT(*) AS total FROM accounts').get(),
      'the result of counting the accounts',
    ).total;
  }

  /** The stored hash, for the sign-in path alone. */
  passwordHash(id: string): string | undefined {
    const row = this.db.raw
      .prepare<[string], { password_hash: string | null }>(
        'SELECT password_hash FROM accounts WHERE id = ?',
      )
      .get(id);
    return row?.password_hash ?? undefined;
  }

  setPassword(id: string, hash: string | null, now: string = new Date().toISOString()): void {
    this.run('UPDATE accounts SET password_hash = ?, updated_at = ? WHERE id = ?', [hash, now, id]);
  }

  setRole(id: string, role: Role, now: string = new Date().toISOString()): void {
    this.run('UPDATE accounts SET role = ?, updated_at = ? WHERE id = ?', [
      parseOrThrow(Role, role, 'role'),
      now,
      id,
    ]);
  }

  setDisabled(id: string, disabled: boolean, now: string = new Date().toISOString()): void {
    this.run('UPDATE accounts SET disabled_at = ?, updated_at = ? WHERE id = ?', [
      disabled ? now : null,
      now,
      id,
    ]);
  }

  /** Binds an identity provider's subject to an account (20E.5). */
  bindIdentity(
    id: string,
    issuer: string,
    subject: string,
    now: string = new Date().toISOString(),
  ): void {
    this.run('UPDATE accounts SET issuer = ?, subject = ?, updated_at = ? WHERE id = ?', [
      issuer,
      subject,
      now,
      id,
    ]);
  }

  private run(sql: string, parameters: readonly (string | null)[]): void {
    const result = this.db.raw.prepare(sql).run(...parameters);
    if (result.changes === 0) {
      throw new DbError('AUTH_ACCOUNT_NOT_FOUND', 'no account with that id', {
        details: { id: parameters.at(-1) },
      });
    }
  }
}

/** Sessions, addressed by the hash of the cookie rather than the cookie. */
export class SessionRepository {
  constructor(private readonly db: Db) {}

  create(record: SessionRecord): SessionRecord {
    this.db.raw
      .prepare(
        `INSERT INTO sessions (id, account_id, csrf, created_at, last_seen_at, expires_at, user_agent, address)
         VALUES (@id, @account_id, @csrf, @created_at, @last_seen_at, @expires_at, @user_agent, @address)`,
      )
      .run({
        id: record.id,
        account_id: record.accountId,
        csrf: record.csrf,
        created_at: record.createdAt,
        last_seen_at: record.lastSeenAt,
        expires_at: record.expiresAt,
        user_agent: record.userAgent ?? null,
        address: record.address ?? null,
      });
    return record;
  }

  byId(id: string): SessionRecord | undefined {
    const row = this.db.raw
      .prepare<[string], SessionRow>(
        'SELECT id, account_id, csrf, created_at, last_seen_at, expires_at, user_agent, address FROM sessions WHERE id = ?',
      )
      .get(id);
    return row === undefined ? undefined : hydrateSession(row);
  }

  touch(id: string, lastSeenAt: string, expiresAt: string): void {
    this.db.raw
      .prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?')
      .run(lastSeenAt, expiresAt, id);
  }

  remove(id: string): void {
    this.db.raw.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  removeForAccount(accountId: string): number {
    return this.db.raw.prepare('DELETE FROM sessions WHERE account_id = ?').run(accountId).changes;
  }

  /** Drops what has expired. Called on every sign-in, which is often enough. */
  removeExpired(now: string): number {
    return this.db.raw.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now).changes;
  }

  forAccount(accountId: string): readonly SessionRecord[] {
    return this.db.raw
      .prepare<[string], SessionRow>(
        'SELECT id, account_id, csrf, created_at, last_seen_at, expires_at, user_agent, address FROM sessions WHERE account_id = ? ORDER BY created_at DESC',
      )
      .all(accountId)
      .map(hydrateSession);
  }
}

/** One single sign-on handshake, between the redirect out and the way back. */
export interface OidcFlow {
  readonly state: string;
  readonly codeVerifier: string;
  readonly nonce: string;
  readonly redirectTo: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

interface FlowRow {
  state: string;
  code_verifier: string;
  nonce: string;
  redirect_to: string;
  created_at: string;
  expires_at: string;
}

/**
 * The handshakes in flight.
 *
 * Server-side and short-lived: a row is written before the browser is sent
 * to the identity provider and deleted the moment it comes back, so a state
 * value cannot be replayed (20E.3).
 */
export class OidcFlowRepository {
  constructor(private readonly db: Db) {}

  create(flow: OidcFlow): OidcFlow {
    this.db.raw
      .prepare(
        `INSERT INTO oidc_flows (state, code_verifier, nonce, redirect_to, created_at, expires_at)
         VALUES (@state, @code_verifier, @nonce, @redirect_to, @created_at, @expires_at)`,
      )
      .run({
        state: flow.state,
        code_verifier: flow.codeVerifier,
        nonce: flow.nonce,
        redirect_to: flow.redirectTo,
        created_at: flow.createdAt,
        expires_at: flow.expiresAt,
      });
    return flow;
  }

  /** Reads a flow and removes it: a handshake is good for one attempt. */
  take(state: string): OidcFlow | undefined {
    const row = this.db.raw
      .prepare<[string], FlowRow>(
        'SELECT state, code_verifier, nonce, redirect_to, created_at, expires_at FROM oidc_flows WHERE state = ?',
      )
      .get(state);
    if (row === undefined) {
      return undefined;
    }
    this.db.raw.prepare('DELETE FROM oidc_flows WHERE state = ?').run(state);
    return {
      state: row.state,
      codeVerifier: row.code_verifier,
      nonce: row.nonce,
      redirectTo: row.redirect_to,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  removeExpired(now: string): number {
    return this.db.raw.prepare('DELETE FROM oidc_flows WHERE expires_at <= ?').run(now).changes;
  }
}

export interface AuthStore {
  readonly db: Db;
  readonly accounts: AccountRepository;
  readonly sessions: SessionRepository;
  readonly flows: OidcFlowRepository;
  close(): void;
}

export function createAuthStore(file: string, options: OpenOptions = {}): AuthStore {
  const db = openAuthDatabase(file, options);
  return {
    db,
    accounts: new AccountRepository(db),
    sessions: new SessionRepository(db),
    flows: new OidcFlowRepository(db),
    close: () => {
      db.close();
    },
  };
}

export type { PublicAccount };
