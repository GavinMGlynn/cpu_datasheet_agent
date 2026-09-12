import { ChipAgentError } from '../errors.js';

/**
 * How many times something may be wrong before it stops being asked.
 *
 * Counted per account and per address, in memory, because there is one
 * process and a lockout that survives a restart would lock the only person
 * who can restart it out of their own machine (20D.1).
 *
 * The delay grows with the count so that a script pays for every guess, and
 * the lockout is short enough that a person who mistyped their password
 * three times is not filing a ticket.
 */

export class LockedOutError extends ChipAgentError {}

export interface LimiterOptions {
  readonly clock?: () => Date;
  /** Failures before the door closes. */
  readonly attempts?: number;
  /** How long a failure counts for. */
  readonly windowMs?: number;
  /** How long the door stays shut once it has. */
  readonly lockoutMs?: number;
}

export interface AttemptLimiter {
  /** Throws when this key is locked out; returns the failures so far. */
  check(key: string): number;
  /** Records a failure and returns how many there have been. */
  fail(key: string): number;
  /** Forgets a key, which is what a correct password does. */
  succeed(key: string): void;
  /** How long until this key may try again, in milliseconds. */
  lockedForMs(key: string): number;
}

interface Attempts {
  count: number;
  firstAt: number;
  lockedUntil: number;
}

export function createAttemptLimiter(options: LimiterOptions = {}): AttemptLimiter {
  const clock = options.clock ?? ((): Date => new Date());
  const limit = options.attempts ?? 5;
  const windowMs = options.windowMs ?? 15 * 60 * 1000;
  const lockoutMs = options.lockoutMs ?? 15 * 60 * 1000;
  const seen = new Map<string, Attempts>();

  const current = (key: string, now: number): Attempts | undefined => {
    const found = seen.get(key);
    if (found === undefined) {
      return undefined;
    }
    if (found.lockedUntil > now) {
      return found;
    }
    // A lockout that has run out starts the count again: otherwise the next
    // mistyped password locks the door for another quarter of an hour, and
    // the one after that, for ever.
    if (found.lockedUntil !== 0 || now - found.firstAt > windowMs) {
      seen.delete(key);
      return undefined;
    }
    return found;
  };

  return {
    check(key) {
      const now = clock().getTime();
      const found = current(key, now);
      if (found === undefined) {
        return 0;
      }
      if (found.lockedUntil > now) {
        throw new LockedOutError(
          'AUTH_LOCKED_OUT',
          'too many failed attempts; wait before trying again',
          { details: { retryAfterMs: found.lockedUntil - now } },
        );
      }
      return found.count;
    },

    fail(key) {
      const now = clock().getTime();
      const found = current(key, now) ?? { count: 0, firstAt: now, lockedUntil: 0 };
      const next: Attempts = {
        count: found.count + 1,
        firstAt: found.firstAt,
        lockedUntil: found.count + 1 >= limit ? now + lockoutMs : 0,
      };
      seen.set(key, next);
      return next.count;
    },

    succeed(key) {
      seen.delete(key);
    },

    lockedForMs(key) {
      const now = clock().getTime();
      const found = current(key, now);
      return found === undefined ? 0 : Math.max(0, found.lockedUntil - now);
    },
  };
}
