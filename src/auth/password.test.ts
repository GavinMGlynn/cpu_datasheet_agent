import { describe, expect, it } from 'vitest';

import {
  CURRENT,
  MAXIMUM_LENGTH,
  MINIMUM_LENGTH,
  checkPassword,
  hashPassword,
  needsRehash,
  verifyPassword,
} from './password.js';

/**
 * scrypt at the real parameters takes tens of milliseconds, which is the
 * point of it. Tests that only care about the encoding use weaker ones and
 * say so.
 */
const weak = { ...CURRENT, cost: 1024 };

describe('checkPassword', () => {
  it('refuses one nobody should be storing, and says why', () => {
    expect(() => {
      checkPassword('short');
    }).toThrow(expect.objectContaining({ code: 'AUTH_PASSWORD_TOO_SHORT' }));
    expect(() => {
      checkPassword('x'.repeat(MAXIMUM_LENGTH + 1));
    }).toThrow(expect.objectContaining({ code: 'AUTH_PASSWORD_TOO_LONG' }));
  });

  it('asks for length and nothing else', () => {
    expect(() => {
      checkPassword('a'.repeat(MINIMUM_LENGTH));
    }).not.toThrow();
    expect(() => {
      checkPassword('correct horse battery staple');
    }).not.toThrow();
  });
});

describe('hashPassword', () => {
  it('records the parameters beside the hash', async () => {
    const stored = await hashPassword('correct horse battery staple', { parameters: weak });
    const [scheme, cost, blockSize, parallelism, salt, key] = stored.split('$');
    expect(scheme).toBe('scrypt');
    expect(cost).toBe('1024');
    expect(blockSize).toBe('8');
    expect(parallelism).toBe('1');
    expect(Buffer.from(salt ?? '', 'base64url')).toHaveLength(16);
    expect(Buffer.from(key ?? '', 'base64url')).toHaveLength(32);
  });

  it('salts, so the same password twice is two different hashes', async () => {
    const first = await hashPassword('correct horse battery staple', { parameters: weak });
    const second = await hashPassword('correct horse battery staple', { parameters: weak });
    expect(first).not.toBe(second);
    await expect(verifyPassword('correct horse battery staple', first)).resolves.toBe(true);
    await expect(verifyPassword('correct horse battery staple', second)).resolves.toBe(true);
  });

  it('refuses to hash one the policy rejects', async () => {
    await expect(hashPassword('too short')).rejects.toThrow(
      expect.objectContaining({ code: 'AUTH_PASSWORD_TOO_SHORT' }),
    );
  });

  it('uses the real parameters when nobody says otherwise', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(stored.startsWith('scrypt$32768$8$1$')).toBe(true);
    await expect(verifyPassword('correct horse battery staple', stored)).resolves.toBe(true);
  });
});

describe('verifyPassword', () => {
  it('says no to the wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple', { parameters: weak });
    await expect(verifyPassword('correct horse battery stapler', stored)).resolves.toBe(false);
  });

  it('normalises, so the same characters typed two ways still match', async () => {
    // "é" composed, then decomposed: one keyboard, two encodings.
    const stored = await hashPassword('café au lait please', { parameters: weak });
    await expect(verifyPassword('café au lait please', stored)).resolves.toBe(true);
  });

  it('refuses a stored value it cannot read rather than guessing', async () => {
    for (const broken of [
      'not-a-hash',
      'bcrypt$1024$8$1$AAAA$BBBB',
      'scrypt$x$8$1$AAAA$BBBB',
      'scrypt$1024$8$1$$BBBB',
      'scrypt$1024$8$1$AAAA$',
    ]) {
      await expect(verifyPassword('correct horse battery staple', broken)).rejects.toThrow(
        expect.objectContaining({ code: 'AUTH_HASH_UNREADABLE' }),
      );
    }
  });
});

describe('needsRehash', () => {
  it('knows a hash written under weaker parameters', async () => {
    expect(
      needsRehash(await hashPassword('correct horse battery staple', { parameters: weak })),
    ).toBe(true);
  });

  it('leaves a current hash alone', async () => {
    const stored = await hashPassword('correct horse battery staple', { parameters: weak });
    expect(needsRehash(stored, weak)).toBe(false);
  });

  it('notices a shorter salt or key as well as a lower cost', async () => {
    const short = { ...weak, saltLength: 8, keyLength: 16 };
    const stored = await hashPassword('correct horse battery staple', { parameters: short });
    expect(needsRehash(stored, weak)).toBe(true);
    expect(needsRehash(stored, { ...weak, saltLength: 8, keyLength: 16, blockSize: 16 })).toBe(
      true,
    );
  });
});
