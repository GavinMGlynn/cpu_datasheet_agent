import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAttemptLimiter } from './attempts.js';
import { createAuthService, sameSecret, type AuthService } from './service.js';
import { CURRENT, hashPassword } from './password.js';
import { createAuthStore, type AuthStore } from './store.js';

const PASSWORD = 'correct horse battery staple';
const weak = { ...CURRENT, cost: 1024 };

let store: AuthStore;
let service: AuthService;
let now: Date;

beforeEach(async () => {
  store = createAuthStore(':memory:');
  now = new Date('2026-09-12T09:00:00.000Z');
  service = createAuthService({
    store,
    clock: () => now,
    limiter: createAttemptLimiter({ clock: () => now, attempts: 3 }),
  });
  store.accounts.create({
    username: 'gavin',
    role: 'admin',
    passwordHash: await hashPassword(PASSWORD, { parameters: weak }),
  });
});

afterEach(() => {
  store.close();
});

describe('signIn', () => {
  it('gives a session to the right password', async () => {
    const issued = await service.signIn('Gavin', PASSWORD, { address: '127.0.0.1' });
    expect(issued.account.username).toBe('gavin');
    expect(service.resolve(issued.cookie)?.account.username).toBe('gavin');
  });

  it('refuses the wrong password, an unknown account and a disabled one alike', async () => {
    // Started one at a time: a rejected promise nobody is waiting on yet is
    // an unhandled rejection, whatever the test does with it afterwards.
    const attempts: readonly [string, string][] = [
      ['gavin', 'not the password'],
      ['nobody', PASSWORD],
      ['a b', PASSWORD],
    ];
    for (const [username, password] of attempts) {
      await expect(service.signIn(username, password)).rejects.toThrow(
        expect.objectContaining({ code: 'AUTH_REFUSED' }),
      );
    }
    const account = store.accounts.byUsername('gavin');
    store.accounts.setDisabled(account?.id ?? '', true, now.toISOString());
    await expect(service.signIn('gavin', PASSWORD)).rejects.toThrow(
      expect.objectContaining({ code: 'AUTH_REFUSED' }),
    );
  });

  it('refuses an account that has no password at all', async () => {
    store.accounts.create({ username: 'sso', role: 'viewer' });
    await expect(service.signIn('sso', PASSWORD)).rejects.toThrow(
      expect.objectContaining({ code: 'AUTH_REFUSED' }),
    );
  });

  it('locks out after enough failures, and says so rather than refusing again', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(service.signIn('gavin', 'wrong', { address: '10.0.0.1' })).rejects.toThrow(
        expect.objectContaining({ code: 'AUTH_REFUSED' }),
      );
    }
    // The right password during a lockout is still refused (20D.4).
    await expect(service.signIn('gavin', PASSWORD, { address: '10.0.0.1' })).rejects.toThrow(
      expect.objectContaining({ code: 'AUTH_LOCKED_OUT' }),
    );
  });

  it('forgets the failures once the password is right', async () => {
    await expect(service.signIn('gavin', 'wrong')).rejects.toThrow();
    await expect(service.signIn('gavin', 'wrong')).rejects.toThrow();
    await expect(service.signIn('gavin', PASSWORD)).resolves.toBeDefined();
    await expect(service.signIn('gavin', 'wrong')).rejects.toThrow(
      expect.objectContaining({ code: 'AUTH_REFUSED' }),
    );
  });

  it('brings a weak stored hash up to date while the password is in hand', async () => {
    const before = store.accounts.passwordHash(store.accounts.byUsername('gavin')?.id ?? '');
    expect(before?.startsWith('scrypt$1024$')).toBe(true);
    await service.signIn('gavin', PASSWORD);
    const after = store.accounts.passwordHash(store.accounts.byUsername('gavin')?.id ?? '');
    expect(after?.startsWith('scrypt$32768$')).toBe(true);
    // And the new hash is still this password.
    await expect(service.signIn('gavin', PASSWORD)).resolves.toBeDefined();
  });
});

describe('signing out', () => {
  it('ends this session', async () => {
    const issued = await service.signIn('gavin', PASSWORD);
    service.signOut(issued.cookie);
    expect(service.resolve(issued.cookie)).toBeUndefined();
  });

  it('ends every session an account has', async () => {
    const first = await service.signIn('gavin', PASSWORD);
    const second = await service.signIn('gavin', PASSWORD);
    expect(service.signOutEverywhere(first.account.id)).toBe(2);
    expect(service.resolve(first.cookie)).toBeUndefined();
    expect(service.resolve(second.cookie)).toBeUndefined();
  });
});

describe('signInAs', () => {
  it('issues a session for an account something else vouched for', () => {
    const account = store.accounts.create({
      username: 'sso',
      role: 'viewer',
      issuer: 'https://issuer.invalid',
      subject: 'subject-1',
    });
    const issued = service.signInAs(account, { address: '127.0.0.1' });
    expect(service.resolve(issued.cookie)?.account.username).toBe('sso');
  });
});

describe('accounts', () => {
  it('counts them, which is what the sign-in page asks first', () => {
    expect(service.accounts()).toBe(1);
  });
});

describe('the defaults', () => {
  it('works with nothing but a store', async () => {
    const plain = createAuthService({ store });
    const issued = await plain.signIn('gavin', PASSWORD);
    expect(plain.resolve(issued.cookie)).toBeDefined();
    plain.signOut(issued.cookie);
  });
});

describe('sameSecret', () => {
  it('compares without leaking where two values differ', () => {
    expect(sameSecret('a-csrf-value', 'a-csrf-value')).toBe(true);
    expect(sameSecret('a-csrf-value', 'a-csrf-valuf')).toBe(false);
    expect(sameSecret('short', 'a much longer value')).toBe(false);
  });
});
