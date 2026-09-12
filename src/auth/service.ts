import { timingSafeEqual } from 'node:crypto';

import { Username, mayWrite, publicAccount, type Account, type PublicAccount } from './account.js';
import { ChipAgentError } from '../errors.js';
import { createAttemptLimiter, type AttemptLimiter } from './attempts.js';
import {
  createSessionManager,
  type IssuedSession,
  type ResolvedSession,
  type SessionContext,
  type SessionManager,
} from './sessions.js';
import { hashPassword, needsRehash, verifyPassword } from './password.js';
import type { AuthStore } from './store.js';

/**
 * Signing in, signing out, and deciding what a signed-in account may do.
 *
 * The refusal is deliberately the same whichever half was wrong, and takes
 * the same time either way: a sign-in that answers faster for an account
 * that does not exist is a way of listing the accounts that do (20D.2).
 */

export class AuthError extends ChipAgentError {}

/** A hash of a password nobody has, so a missing account still costs a verify. */
const ABSENT =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export interface SignInContext extends SessionContext {
  /** Counted separately from the username, so one address cannot sweep. */
  readonly address?: string | undefined;
}

export interface AuthServiceOptions {
  readonly store: AuthStore;
  readonly clock?: () => Date;
  readonly sessions?: SessionManager;
  readonly limiter?: AttemptLimiter;
}

export interface AuthService {
  readonly store: AuthStore;
  readonly sessions: SessionManager;
  /** How many accounts exist, which is what the sign-in page asks first. */
  accounts(): number;
  signIn(username: string, password: string, context?: SignInContext): Promise<IssuedSession>;
  signOut(cookie: string): void;
  signOutEverywhere(accountId: string): number;
  resolve(cookie: string | undefined): ResolvedSession | undefined;
  /** Signs in an account that an identity provider has already vouched for. */
  signInAs(account: Account, context?: SessionContext): IssuedSession;
}

function refused(): AuthError {
  return new AuthError('AUTH_REFUSED', 'that username and password do not match an account');
}

export function createAuthService(options: AuthServiceOptions): AuthService {
  const { store } = options;
  const clock = options.clock ?? ((): Date => new Date());
  const sessions = options.sessions ?? createSessionManager({ store, clock });
  const limiter = options.limiter ?? createAttemptLimiter({ clock });

  return {
    store,
    sessions,

    accounts() {
      return store.accounts.count();
    },

    async signIn(username, password, context = {}) {
      const parsed = Username.safeParse(username);
      const name = parsed.success ? parsed.data : username.trim().toLowerCase().slice(0, 120);
      const keys = [`user:${name}`];
      if (context.address !== undefined) {
        keys.push(`address:${context.address}`);
      }
      for (const key of keys) {
        limiter.check(key);
      }

      const account = store.accounts.byUsername(name);
      const stored = account === undefined ? undefined : store.accounts.passwordHash(account.id);
      // Always verify something: the work is the same whether the account is
      // there or not, so the timing says nothing about which it was.
      const matches = await verifyPassword(password, stored ?? ABSENT);
      const allowed =
        account !== undefined &&
        stored !== undefined &&
        account.disabledAt === undefined &&
        matches;
      if (!allowed) {
        for (const key of keys) {
          limiter.fail(key);
        }
        throw refused();
      }
      for (const key of keys) {
        limiter.succeed(key);
      }
      if (needsRehash(stored)) {
        // Signing in is the only moment the password is in hand, so it is
        // the only moment the stored hash can be brought up to date.
        store.accounts.setPassword(account.id, await hashPassword(password), clock().toISOString());
      }
      return sessions.issue(account, context);
    },

    signInAs(account, context = {}) {
      return sessions.issue(account, context);
    },

    signOut(cookie) {
      sessions.revoke(cookie);
    },

    signOutEverywhere(accountId) {
      return sessions.revokeAll(accountId);
    },

    resolve(cookie) {
      return sessions.resolve(cookie);
    },
  };
}

/** Constant-time comparison of two values a browser sent back. */
export function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    // Comparing different lengths cannot be constant time; the length of a
    // CSRF value is not the secret, its content is.
    return false;
  }
  return timingSafeEqual(a, b);
}

export { mayWrite, publicAccount };
export type { PublicAccount };
