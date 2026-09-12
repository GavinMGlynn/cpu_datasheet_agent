import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Account } from './account.js';
import { createAuthStore, type AuthStore } from './store.js';

let store: AuthStore;

beforeEach(() => {
  store = createAuthStore(':memory:');
});

afterEach(() => {
  store.close();
});

type NewAccount = Parameters<typeof store.accounts.create>[0];

function account(overrides: Partial<Record<keyof NewAccount, string | undefined>> = {}): Account {
  const base: Record<string, string | undefined> = {
    username: 'gavin',
    role: 'admin',
    passwordHash: 'scrypt$1024$8$1$AAAA$BBBB',
    ...overrides,
  };
  const given = Object.fromEntries(
    Object.entries(base).filter(([, value]) => value !== undefined),
  ) as unknown as NewAccount;
  return store.accounts.create(given);
}

describe('accounts', () => {
  it('stores one and reads it back without its hash', () => {
    const created = account({ displayName: 'Gavin' });
    expect(created).toMatchObject({ username: 'gavin', displayName: 'Gavin', role: 'admin' });
    expect(created.hasPassword).toBe(true);
    expect(JSON.stringify(created)).not.toContain('scrypt');
    expect(store.accounts.byUsername('gavin')).toStrictEqual(created);
    expect(store.accounts.byId(created.id)).toStrictEqual(created);
    expect(store.accounts.byId('00000000-0000-4000-8000-000000000000')).toBeUndefined();
    expect(store.accounts.byUsername('nobody')).toBeUndefined();
  });

  it('folds the username, so one person is one account', () => {
    account({ username: 'Gavin' });
    expect(store.accounts.byUsername('GAVIN')?.username).toBe('gavin');
    expect(() => account({ username: 'gavin' })).toThrow(
      expect.objectContaining({ code: 'AUTH_ACCOUNT_EXISTS' }),
    );
  });

  it('names the account after the username when nobody said otherwise', () => {
    expect(account().displayName).toBe('gavin');
  });

  it('refuses a username that is not one', () => {
    expect(() => account({ username: 'a b' })).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
  });

  it('hands the hash out only when asked for it directly', () => {
    const created = account();
    expect(store.accounts.passwordHash(created.id)).toBe('scrypt$1024$8$1$AAAA$BBBB');
    expect(store.accounts.passwordHash('00000000-0000-4000-8000-000000000000')).toBeUndefined();
  });

  it('has no hash for an account that signs in another way', () => {
    const created = account({
      username: 'sso',
      passwordHash: undefined,
      issuer: 'https://issuer.invalid',
      subject: 'subject-1',
    });
    expect(created.hasPassword).toBe(false);
    expect(store.accounts.passwordHash(created.id)).toBeUndefined();
    expect(store.accounts.byIdentity('https://issuer.invalid', 'subject-1')).toStrictEqual(created);
    expect(store.accounts.byIdentity('https://issuer.invalid', 'nobody')).toBeUndefined();
  });

  it('changes what can be changed, and says when there is nothing to change', () => {
    const created = account();
    store.accounts.setRole(created.id, 'viewer');
    expect(store.accounts.byId(created.id)?.role).toBe('viewer');
    store.accounts.setPassword(created.id, null);
    expect(store.accounts.byId(created.id)?.hasPassword).toBe(false);
    store.accounts.setDisabled(created.id, true);
    expect(store.accounts.byId(created.id)?.disabledAt).toBeDefined();
    store.accounts.setDisabled(created.id, false);
    expect(store.accounts.byId(created.id)?.disabledAt).toBeUndefined();
    store.accounts.bindIdentity(created.id, 'https://issuer.invalid', 'subject-2');
    expect(store.accounts.byId(created.id)?.subject).toBe('subject-2');
    for (const change of [
      () => {
        store.accounts.setRole('nobody', 'admin');
      },
      () => {
        store.accounts.setPassword('nobody', null);
      },
      () => {
        store.accounts.setDisabled('nobody', true);
      },
      () => {
        store.accounts.bindIdentity('nobody', 'https://issuer.invalid', 'subject-3');
      },
    ]) {
      expect(change).toThrow(expect.objectContaining({ code: 'AUTH_ACCOUNT_NOT_FOUND' }));
    }
  });

  it('lists them in a fixed order, and counts them', () => {
    expect(store.accounts.count()).toBe(0);
    account({ username: 'zoe', passwordHash: undefined });
    account();
    expect(store.accounts.list().map((one) => one.username)).toStrictEqual(['gavin', 'zoe']);
    expect(store.accounts.count()).toBe(2);
  });

  it('refuses a role it has never heard of', () => {
    expect(() => account({ username: 'other', role: 'root' })).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
  });
});

describe('a store on disk', () => {
  it('makes the directory it was pointed at, because a file needs one', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'chip-auth-'));
    try {
      const onDisk = createAuthStore(path.join(root, 'nested', 'auth.sqlite'));
      onDisk.accounts.create({ username: 'gavin', role: 'admin' });
      expect(onDisk.accounts.count()).toBe(1);
      onDisk.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('sessions', () => {
  const record = (id: string, accountId: string, expiresAt: string) => ({
    id,
    accountId,
    csrf: 'csrf-value',
    createdAt: '2026-09-12T09:00:00.000Z',
    lastSeenAt: '2026-09-12T09:00:00.000Z',
    expiresAt,
    userAgent: 'a browser',
    address: '127.0.0.1',
  });

  it('stores one against its account and reads it back', () => {
    const created = account();
    const session = store.sessions.create(record('hash-1', created.id, '2026-09-13T09:00:00.000Z'));
    expect(store.sessions.byId('hash-1')).toStrictEqual(session);
    expect(store.sessions.byId('nobody')).toBeUndefined();
  });

  it('keeps what it was told and nothing more', () => {
    const created = account();
    store.sessions.create({
      id: 'hash-2',
      accountId: created.id,
      csrf: 'csrf-value',
      createdAt: '2026-09-12T09:00:00.000Z',
      lastSeenAt: '2026-09-12T09:00:00.000Z',
      expiresAt: '2026-09-13T09:00:00.000Z',
    });
    const stored = store.sessions.byId('hash-2');
    expect(stored?.userAgent).toBeUndefined();
    expect(stored?.address).toBeUndefined();
  });

  it('moves the clock forward on a session still in use', () => {
    const created = account();
    store.sessions.create(record('hash-3', created.id, '2026-09-13T09:00:00.000Z'));
    store.sessions.touch('hash-3', '2026-09-12T11:00:00.000Z', '2026-09-13T11:00:00.000Z');
    expect(store.sessions.byId('hash-3')).toMatchObject({
      lastSeenAt: '2026-09-12T11:00:00.000Z',
      expiresAt: '2026-09-13T11:00:00.000Z',
    });
  });

  it('removes one, all of an account’s, and everything expired', () => {
    const created = account();
    store.sessions.create(record('hash-4', created.id, '2026-09-13T09:00:00.000Z'));
    store.sessions.create(record('hash-5', created.id, '2026-09-01T09:00:00.000Z'));
    expect(store.sessions.forAccount(created.id)).toHaveLength(2);
    expect(store.sessions.removeExpired('2026-09-12T09:00:00.000Z')).toBe(1);
    store.sessions.remove('hash-4');
    expect(store.sessions.forAccount(created.id)).toHaveLength(0);
    store.sessions.create(record('hash-6', created.id, '2026-09-13T09:00:00.000Z'));
    expect(store.sessions.removeForAccount(created.id)).toBe(1);
  });

  it('goes when the account goes', () => {
    const created = account();
    store.sessions.create(record('hash-7', created.id, '2026-09-13T09:00:00.000Z'));
    store.db.raw.prepare('DELETE FROM accounts WHERE id = ?').run(created.id);
    expect(store.sessions.byId('hash-7')).toBeUndefined();
  });
});
