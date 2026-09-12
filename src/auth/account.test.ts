import { describe, expect, it } from 'vitest';

import { Account, Username, mayWrite, publicAccount } from './account.js';
import { parseOrThrow } from '../core/validation-error.js';

const stored = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'gavin',
  displayName: 'Gavin',
  role: 'admin',
  hasPassword: true,
  createdAt: '2026-09-12T09:00:00.000Z',
  updatedAt: '2026-09-12T09:00:00.000Z',
};

describe('Username', () => {
  it('folds case, so one person is one account', () => {
    expect(Username.parse('  Gavin  ')).toBe('gavin');
    expect(Username.parse('GAVIN@EXAMPLE.COM')).toBe('gavin@example.com');
  });

  it('takes the characters a name is made of, and no others', () => {
    for (const good of ['gavin', 'g.glynn', 'gavin+work', 'a_b-c', 'gavin@example.com']) {
      expect(() => Username.parse(good)).not.toThrow();
    }
    for (const bad of ['ab', 'a b', '.leading', 'has/slash', 'x'.repeat(121)]) {
      expect(() => Username.parse(bad)).toThrow();
    }
  });
});

describe('mayWrite', () => {
  it('is the whole of the permission model', () => {
    expect(mayWrite('admin')).toBe(true);
    expect(mayWrite('viewer')).toBe(false);
  });
});

describe('publicAccount', () => {
  it('carries what the page shows and nothing that identifies a session', () => {
    const account = parseOrThrow(
      Account,
      { ...stored, issuer: 'https://issuer.invalid', subject: 'subject-1' },
      'Account',
    );
    expect(publicAccount(account)).toStrictEqual({
      username: 'gavin',
      displayName: 'Gavin',
      role: 'admin',
    });
  });
});
