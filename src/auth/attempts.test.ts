import { describe, expect, it } from 'vitest';

import { createAttemptLimiter } from './attempts.js';

function limiter(now: { value: Date }) {
  return createAttemptLimiter({
    clock: () => now.value,
    attempts: 3,
    windowMs: 10 * 60 * 1000,
    lockoutMs: 5 * 60 * 1000,
  });
}

describe('createAttemptLimiter', () => {
  it('counts failures and lets them through until the limit', () => {
    const now = { value: new Date('2026-09-12T09:00:00.000Z') };
    const limit = limiter(now);
    expect(limit.check('user:gavin')).toBe(0);
    expect(limit.fail('user:gavin')).toBe(1);
    expect(limit.check('user:gavin')).toBe(1);
    expect(limit.fail('user:gavin')).toBe(2);
    expect(limit.check('user:gavin')).toBe(2);
  });

  it('shuts the door at the limit, and says how long for', () => {
    const now = { value: new Date('2026-09-12T09:00:00.000Z') };
    const limit = limiter(now);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      limit.fail('user:gavin');
    }
    expect(limit.lockedForMs('user:gavin')).toBe(5 * 60 * 1000);
    expect(() => limit.check('user:gavin')).toThrow(
      expect.objectContaining({ code: 'AUTH_LOCKED_OUT' }),
    );
  });

  it('opens it again once the lockout has passed', () => {
    const now = { value: new Date('2026-09-12T09:00:00.000Z') };
    const limit = limiter(now);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      limit.fail('user:gavin');
    }
    now.value = new Date('2026-09-12T09:06:00.000Z');
    expect(limit.lockedForMs('user:gavin')).toBe(0);
    expect(limit.check('user:gavin')).toBe(0);
  });

  it('forgets old failures rather than adding them up for ever', () => {
    const now = { value: new Date('2026-09-12T09:00:00.000Z') };
    const limit = limiter(now);
    limit.fail('user:gavin');
    limit.fail('user:gavin');
    now.value = new Date('2026-09-12T09:20:00.000Z');
    expect(limit.check('user:gavin')).toBe(0);
    expect(limit.fail('user:gavin')).toBe(1);
  });

  it('forgets everything about a key that got it right', () => {
    const now = { value: new Date('2026-09-12T09:00:00.000Z') };
    const limit = limiter(now);
    limit.fail('user:gavin');
    limit.fail('user:gavin');
    limit.succeed('user:gavin');
    expect(limit.check('user:gavin')).toBe(0);
    expect(limit.lockedForMs('user:gavin')).toBe(0);
  });

  it('counts each key on its own', () => {
    const now = { value: new Date('2026-09-12T09:00:00.000Z') };
    const limit = limiter(now);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      limit.fail('address:10.0.0.1');
    }
    expect(() => limit.check('address:10.0.0.1')).toThrow();
    expect(limit.check('user:gavin')).toBe(0);
  });

  it('has defaults, so it can be asked for without arguments', () => {
    const limit = createAttemptLimiter();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      limit.fail('user:gavin');
    }
    expect(() => limit.check('user:gavin')).toThrow(
      expect.objectContaining({ code: 'AUTH_LOCKED_OUT' }),
    );
    expect(limit.lockedForMs('user:gavin')).toBeGreaterThan(14 * 60 * 1000);
    expect(limit.lockedForMs('user:nobody')).toBe(0);
  });
});
