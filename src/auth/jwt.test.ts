import { generateKeyPairSync, createSign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { fakeIssuer, idClaims } from '../../test/helpers/issuer.js';
import { pkce, readToken, verifyIdToken } from './jwt.js';

/**
 * The checks an ID token has to pass.
 *
 * Every one of them is the only thing standing between "the issuer said so"
 * and "somebody said so", which is why each has a test of its own.
 */

const now = new Date('2026-09-12T09:00:00.000Z');

async function keysOf(issuer: ReturnType<typeof fakeIssuer>): Promise<readonly unknown[]> {
  const response = await issuer.fetch(`${issuer.issuer}/jwks`);
  const body = (await response.json()) as { keys: readonly unknown[] };
  return body.keys;
}

describe('readToken', () => {
  it('refuses anything that is not three parts', () => {
    expect(() => readToken('one.two')).toThrow(
      expect.objectContaining({ code: 'AUTH_TOKEN_UNREADABLE' }),
    );
  });

  it('refuses a header or a body that is not JSON', () => {
    const bad = `${Buffer.from('not json').toString('base64url')}.${Buffer.from('{}').toString('base64url')}.sig`;
    expect(() => readToken(bad)).toThrow(
      expect.objectContaining({ code: 'AUTH_TOKEN_UNREADABLE' }),
    );
    const badBody = `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from('nope').toString('base64url')}.sig`;
    expect(() => readToken(badBody)).toThrow(
      expect.objectContaining({ code: 'AUTH_TOKEN_UNREADABLE' }),
    );
  });

  it('refuses a header that names no algorithm', () => {
    const token = `${Buffer.from('{"typ":"JWT"}').toString('base64url')}.${Buffer.from('{}').toString('base64url')}.sig`;
    expect(() => readToken(token)).toThrow(
      expect.objectContaining({ code: 'AUTH_TOKEN_UNREADABLE' }),
    );
  });
});

describe('verifyIdToken', () => {
  it('accepts a token signed by the issuer, for this client, now', async () => {
    const issuer = fakeIssuer();
    const token = issuer.sign(idClaims(issuer, 'the-nonce'));
    const claims = verifyIdToken(token, {
      issuer: issuer.issuer,
      audience: issuer.clientId,
      nonce: 'the-nonce',
      keys: (await keysOf(issuer)) as never,
      now,
    });
    expect(claims.sub).toBe('subject-1');
  });

  it('accepts an audience list that contains this client', async () => {
    const issuer = fakeIssuer();
    const token = issuer.sign(idClaims(issuer, 'the-nonce', { aud: ['other', issuer.clientId] }));
    expect(
      verifyIdToken(token, {
        issuer: issuer.issuer,
        audience: issuer.clientId,
        nonce: 'the-nonce',
        keys: (await keysOf(issuer)) as never,
        now,
      }).sub,
    ).toBe('subject-1');
  });

  it('refuses an algorithm it does not implement', async () => {
    const issuer = fakeIssuer();
    const keys = (await keysOf(issuer)) as never;
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(idClaims(issuer, 'the-nonce'))).toString('base64url');
    expect(() =>
      verifyIdToken(`${header}.${body}.signature`, {
        issuer: issuer.issuer,
        audience: issuer.clientId,
        nonce: 'the-nonce',
        keys,
        now,
      }),
    ).toThrow(expect.objectContaining({ code: 'AUTH_TOKEN_ALGORITHM' }));
  });

  it('refuses a token whose key id nobody published', async () => {
    const issuer = fakeIssuer();
    const keys = (await keysOf(issuer)) as never;
    const token = issuer.sign(idClaims(issuer, 'the-nonce'), { kid: 'some-other-key' });
    expect(() =>
      verifyIdToken(token, {
        issuer: issuer.issuer,
        audience: issuer.clientId,
        nonce: 'the-nonce',
        keys,
        now,
      }),
    ).toThrow(expect.objectContaining({ code: 'AUTH_TOKEN_KEY_UNKNOWN' }));
  });

  it('says so when a token names no key and the issuer published none', () => {
    const issuer = fakeIssuer();
    const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(idClaims(issuer, 'the-nonce'))).toString('base64url');
    expect(() =>
      verifyIdToken(`${header}.${body}.signature`, {
        issuer: issuer.issuer,
        audience: issuer.clientId,
        nonce: 'the-nonce',
        keys: [],
        now,
      }),
    ).toThrow(expect.objectContaining({ code: 'AUTH_TOKEN_KEY_UNKNOWN' }));
  });

  it('tries every published key when the token names none', async () => {
    const issuer = fakeIssuer();
    const spare = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const published = await keysOf(issuer);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(idClaims(issuer, 'the-nonce'))).toString('base64url');
    const signature = createSign('sha256')
      .update(`${header}.${body}`)
      .sign(spare.privateKey)
      .toString('base64url');
    // Signed by a key the issuer never published, with no kid to narrow it:
    // every candidate is tried, and none of them match.
    expect(() =>
      verifyIdToken(`${header}.${body}.${signature}`, {
        issuer: issuer.issuer,
        audience: issuer.clientId,
        nonce: 'the-nonce',
        keys: published as never,
        now,
      }),
    ).toThrow(expect.objectContaining({ code: 'AUTH_TOKEN_SIGNATURE' }));
  });

  it('refuses one that is not valid yet', async () => {
    const issuer = fakeIssuer();
    const keys = (await keysOf(issuer)) as never;
    const seconds = Math.floor(now.getTime() / 1000);
    const token = issuer.sign(idClaims(issuer, 'the-nonce', { nbf: seconds + 600 }));
    expect(() =>
      verifyIdToken(token, {
        issuer: issuer.issuer,
        audience: issuer.clientId,
        nonce: 'the-nonce',
        keys,
        now,
      }),
    ).toThrow(expect.objectContaining({ code: 'AUTH_TOKEN_EXPIRED' }));
  });

  it('refuses one with no expiry at all', async () => {
    const issuer = fakeIssuer();
    const keys = (await keysOf(issuer)) as never;
    const token = issuer.sign(idClaims(issuer, 'the-nonce', { exp: 'soon' }));
    expect(() =>
      verifyIdToken(token, {
        issuer: issuer.issuer,
        audience: issuer.clientId,
        nonce: 'the-nonce',
        keys,
        now,
      }),
    ).toThrow(expect.objectContaining({ code: 'AUTH_TOKEN_EXPIRED' }));
  });

  it('allows a little clock difference, and no more', async () => {
    const issuer = fakeIssuer();
    const seconds = Math.floor(now.getTime() / 1000);
    const token = issuer.sign(idClaims(issuer, 'the-nonce', { exp: seconds - 30 }));
    const options = {
      issuer: issuer.issuer,
      audience: issuer.clientId,
      nonce: 'the-nonce',
      keys: (await keysOf(issuer)) as never,
      now,
    };
    expect(verifyIdToken(token, options).sub).toBe('subject-1');
    expect(() => verifyIdToken(token, { ...options, skewSeconds: 5 })).toThrow(
      expect.objectContaining({ code: 'AUTH_TOKEN_EXPIRED' }),
    );
  });
});

describe('ES256, which some issuers use', () => {
  it('is accepted when the signature is the issuer\u2019s', () => {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'ec-1', alg: 'ES256' };
    const issuer = fakeIssuer();
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'ec-1' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(idClaims(issuer, 'the-nonce'))).toString('base64url');
    const signature = createSign('sha256')
      .update(`${header}.${body}`)
      .sign({ key: pair.privateKey, dsaEncoding: 'ieee-p1363' })
      .toString('base64url');
    expect(
      verifyIdToken(`${header}.${body}.${signature}`, {
        issuer: issuer.issuer,
        audience: issuer.clientId,
        nonce: 'the-nonce',
        keys: [jwk] as never,
        now,
      }).sub,
    ).toBe('subject-1');
  });
});

describe('the claims themselves', () => {
  it('refuses another issuer, another client, another sign-in, and no subject', async () => {
    const issuer = fakeIssuer();
    const keys = (await keysOf(issuer)) as never;
    const options = {
      issuer: issuer.issuer,
      audience: issuer.clientId,
      nonce: 'the-nonce',
      keys,
      now,
    };
    for (const [overrides, code] of [
      [{ iss: 'https://elsewhere.invalid' }, 'AUTH_TOKEN_ISSUER'],
      [{ aud: 'another-client' }, 'AUTH_TOKEN_AUDIENCE'],
      [{ nonce: 'another sign-in' }, 'AUTH_TOKEN_NONCE'],
      [{ sub: 42 }, 'AUTH_TOKEN_UNREADABLE'],
    ] as const) {
      const token = issuer.sign(idClaims(issuer, 'the-nonce', overrides));
      expect(() => verifyIdToken(token, options)).toThrow(expect.objectContaining({ code }));
    }
  });
});

describe('pkce', () => {
  it('makes a verifier and the challenge for it', () => {
    const { verifier, challenge } = pkce((size) => Buffer.alloc(size, 7));
    expect(verifier).toHaveLength(43);
    expect(challenge).not.toBe(verifier);
    // The same verifier always gives the same challenge; that is the point.
    expect(pkce((size) => Buffer.alloc(size, 7)).challenge).toBe(challenge);
  });

  it('takes real random bytes when it is given none', () => {
    expect(pkce().verifier).not.toBe(pkce().verifier);
  });
});
