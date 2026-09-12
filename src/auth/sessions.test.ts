import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Account } from './account.js';
import { createSessionManager, hashSession, type SessionManager } from './sessions.js';
import { createAuthStore, type AuthStore } from './store.js';
import { required } from '../util/present.js';

let store: AuthStore;
let now: Date;
let manager: SessionManager;
let account: Account;
let counter: number;

/** Predictable "random", so a test can name the cookie it expects. */
function random(size: number): Buffer {
  counter += 1;
  return Buffer.alloc(size, counter);
}

beforeEach(() => {
  store = createAuthStore(':memory:');
  now = new Date('2026-09-12T09:00:00.000Z');
  counter = 0;
  manager = createSessionManager({
    store,
    clock: () => now,
    random,
    idleMs: 60 * 60 * 1000,
    absoluteMs: 24 * 60 * 60 * 1000,
  });
  account = store.accounts.create({ username: 'gavin', role: 'admin' });
});

afterEach(() => {
  store.close();
});

describe('issue', () => {
  it('hands out a cookie and stores only its hash', () => {
    const issued = manager.issue(account, { userAgent: 'a browser', address: '127.0.0.1' });
    expect(issued.cookie).toHaveLength(43);
    expect(issued.csrf).not.toBe(issued.cookie);
    expect(store.sessions.byId(issued.record.id)).toBeDefined();
    expect(issued.record.id).toBe(hashSession(issued.cookie));
    expect(issued.record.id).not.toContain(issued.cookie);
    expect(issued.record).toMatchObject({ userAgent: 'a browser', address: '127.0.0.1' });
  });

  it('gives every sign-in a session of its own, which is what stops fixation', () => {
    const first = manager.issue(account);
    const second = manager.issue(account);
    expect(second.cookie).not.toBe(first.cookie);
    expect(store.sessions.forAccount(account.id)).toHaveLength(2);
  });

  it('sweeps what has already expired while it is there', () => {
    const first = manager.issue(account);
    now = new Date('2026-09-12T11:00:00.000Z');
    manager.issue(account);
    expect(store.sessions.byId(first.record.id)).toBeUndefined();
  });

  it('keeps a long user agent and address down to a sensible length', () => {
    const issued = manager.issue(account, { userAgent: 'u'.repeat(900), address: 'a'.repeat(200) });
    expect(issued.record.userAgent).toHaveLength(400);
    expect(issued.record.address).toHaveLength(80);
  });
});

describe('the defaults', () => {
  it('reads the clock, takes real random bytes, and lasts the stated time', () => {
    const plain = createSessionManager({ store });
    const issued = plain.issue(account);
    expect(issued.cookie).toHaveLength(43);
    const found = plain.resolve(issued.cookie);
    expect(found?.account.username).toBe('gavin');
    // Twelve hours idle, seven days absolute (20C.2).
    expect(
      Date.parse(required(found, 'the session it just issued').session.expiresAt) - Date.now(),
    ).toBeGreaterThan(11 * 60 * 60 * 1000);
  });
});

describe('resolve', () => {
  it('finds the account behind a cookie, and moves the idle clock forward', () => {
    const issued = manager.issue(account);
    now = new Date('2026-09-12T09:30:00.000Z');
    const found = manager.resolve(issued.cookie);
    expect(found?.account.username).toBe('gavin');
    expect(found?.session.expiresAt).toBe('2026-09-12T10:30:00.000Z');
    expect(store.sessions.byId(issued.record.id)?.lastSeenAt).toBe('2026-09-12T09:30:00.000Z');
  });

  it('has nothing for no cookie, an empty one, or one nobody issued', () => {
    expect(manager.resolve(undefined)).toBeUndefined();
    expect(manager.resolve('')).toBeUndefined();
    expect(manager.resolve('a-cookie-nobody-issued')).toBeUndefined();
  });

  it('refuses a session that has been idle too long, and forgets it', () => {
    const issued = manager.issue(account);
    now = new Date('2026-09-12T10:30:00.000Z');
    expect(manager.resolve(issued.cookie)).toBeUndefined();
    expect(store.sessions.byId(issued.record.id)).toBeUndefined();
  });

  it('refuses one that has simply been open too long, however busy', () => {
    const issued = manager.issue(account);
    // Used every half hour, so the idle clock never runs out.
    for (let minutes = 30; minutes <= 23 * 60; minutes += 30) {
      now = new Date(Date.parse('2026-09-12T09:00:00.000Z') + minutes * 60 * 1000);
      expect(manager.resolve(issued.cookie)).toBeDefined();
    }
    now = new Date('2026-09-13T09:00:00.000Z');
    expect(manager.resolve(issued.cookie)).toBeUndefined();
  });

  it('refuses one whose account was disabled while it was open', () => {
    const issued = manager.issue(account);
    store.accounts.setDisabled(account.id, true, now.toISOString());
    expect(manager.resolve(issued.cookie)).toBeUndefined();
    expect(store.sessions.byId(issued.record.id)).toBeUndefined();
  });

  it('refuses one whose account is gone', () => {
    const issued = manager.issue(account);
    // The row outlives the account only if something deleted the account
    // behind SQLite's back; the session goes rather than resolving to nobody.
    store.db.raw.prepare('PRAGMA foreign_keys = OFF').run();
    store.db.raw.prepare('DELETE FROM accounts WHERE id = ?').run(account.id);
    expect(manager.resolve(issued.cookie)).toBeUndefined();
    expect(store.sessions.byId(issued.record.id)).toBeUndefined();
  });
});

describe('revoking', () => {
  it('signs one browser out', () => {
    const issued = manager.issue(account);
    manager.revoke(issued.cookie);
    expect(manager.resolve(issued.cookie)).toBeUndefined();
  });

  it('signs every browser out', () => {
    manager.issue(account);
    manager.issue(account);
    expect(manager.revokeAll(account.id)).toBe(2);
    expect(store.sessions.forAccount(account.id)).toHaveLength(0);
  });
});
