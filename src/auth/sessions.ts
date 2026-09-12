import { createHash, randomBytes } from 'node:crypto';

import type { Account } from './account.js';
import type { AuthStore, SessionRecord } from './store.js';

/**
 * Sessions: what the browser holds, and what the server stores.
 *
 * The cookie is 32 random bytes. What is stored is its SHA-256, so a copy of
 * the identity database cannot be replayed against the site — the same
 * reason a password is not stored either (20C.1).
 *
 * Two lifetimes: an idle timeout that moves forward while the session is in
 * use, and an absolute one that does not. A session that never expires is a
 * password that was written down.
 */

export const SESSION_COOKIE = 'chip_session';
export const CSRF_COOKIE = 'chip_csrf';

export const IDLE_MS = 12 * 60 * 60 * 1000;
export const ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;

/** The value a browser holds, and the pair of cookies that carry it. */
export interface IssuedSession {
  readonly cookie: string;
  readonly csrf: string;
  readonly record: SessionRecord;
  readonly account: Account;
}

export interface SessionContext {
  readonly userAgent?: string | undefined;
  readonly address?: string | undefined;
}

export interface SessionManagerOptions {
  readonly store: AuthStore;
  readonly clock?: () => Date;
  readonly random?: (size: number) => Buffer;
  readonly idleMs?: number;
  readonly absoluteMs?: number;
}

/** What a session lookup found: the account, and the session it came from. */
export interface ResolvedSession {
  readonly account: Account;
  readonly session: SessionRecord;
}

export interface SessionManager {
  issue(account: Account, context?: SessionContext): IssuedSession;
  resolve(cookie: string | undefined): ResolvedSession | undefined;
  revoke(cookie: string): void;
  revokeAll(accountId: string): number;
}

/** The stored form of a session cookie. Never reversible, always comparable. */
export function hashSession(cookie: string): string {
  return createHash('sha256').update(cookie).digest('base64url');
}

export function createSessionManager(options: SessionManagerOptions): SessionManager {
  const { store } = options;
  const clock = options.clock ?? ((): Date => new Date());
  const random = options.random ?? randomBytes;
  const idleMs = options.idleMs ?? IDLE_MS;
  const absoluteMs = options.absoluteMs ?? ABSOLUTE_MS;

  return {
    issue(account, context = {}) {
      const now = clock();
      // Anything already expired goes at the same time: there is no other
      // moment this project is reliably running code.
      store.sessions.removeExpired(now.toISOString());
      const cookie = random(32).toString('base64url');
      const csrf = random(32).toString('base64url');
      const record = store.sessions.create({
        id: hashSession(cookie),
        accountId: account.id,
        csrf,
        createdAt: now.toISOString(),
        lastSeenAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + idleMs).toISOString(),
        ...(context.userAgent === undefined ? {} : { userAgent: context.userAgent.slice(0, 400) }),
        ...(context.address === undefined ? {} : { address: context.address.slice(0, 80) }),
      });
      return { cookie, csrf, record, account };
    },

    resolve(cookie) {
      if (cookie === undefined || cookie === '') {
        return undefined;
      }
      const record = store.sessions.byId(hashSession(cookie));
      if (record === undefined) {
        return undefined;
      }
      const now = clock();
      const idleOut = Date.parse(record.expiresAt) <= now.getTime();
      const absoluteOut = Date.parse(record.createdAt) + absoluteMs <= now.getTime();
      if (idleOut || absoluteOut) {
        store.sessions.remove(record.id);
        return undefined;
      }
      const account = store.accounts.byId(record.accountId);
      if (account === undefined || account.disabledAt !== undefined) {
        // The account went, or was disabled while this session was open: the
        // session goes with it rather than outliving the decision.
        store.sessions.remove(record.id);
        return undefined;
      }
      const expiresAt = new Date(now.getTime() + idleMs).toISOString();
      store.sessions.touch(record.id, now.toISOString(), expiresAt);
      return { account, session: { ...record, lastSeenAt: now.toISOString(), expiresAt } };
    },

    revoke(cookie) {
      store.sessions.remove(hashSession(cookie));
    },

    revokeAll(accountId) {
      return store.sessions.removeForAccount(accountId);
    },
  };
}
