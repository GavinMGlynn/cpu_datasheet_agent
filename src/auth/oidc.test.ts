import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fakeIssuer, idClaims, type FakeIssuer } from '../../test/helpers/issuer.js';
import { createOidc, oidcConfigFrom, type Oidc } from './oidc.js';
import { createAuthStore, type AuthStore } from './store.js';

/**
 * Single sign-on, against an issuer with real keys.
 *
 * Every refusal is a test of its own: an ID token is the whole of the claim
 * that someone is who they say they are, and a check that is not exercised
 * is a check that might not be there.
 */

let store: AuthStore;
let issuer: FakeIssuer;
let oidc: Oidc;
let now: Date;
let counter: number;

function random(size: number): Buffer {
  counter += 1;
  return Buffer.alloc(size, counter);
}

beforeEach(() => {
  store = createAuthStore(':memory:');
  issuer = fakeIssuer();
  now = new Date('2026-09-12T09:00:00.000Z');
  counter = 0;
  oidc = createOidc({
    config: {
      issuer: issuer.issuer,
      clientId: issuer.clientId,
      clientSecret: 'a-client-secret',
      redirectUri: 'http://127.0.0.1:5174/api/auth/oidc/callback',
    },
    store,
    fetch: issuer.fetch,
    clock: () => now,
    random,
  });
});

afterEach(() => {
  store.close();
});

/** Starts a handshake and answers it the way a good issuer would. */
async function handshake(claims: Record<string, unknown> = {}) {
  const started = await oidc.begin('/parts');
  const flow = store.db.raw
    .prepare<[string], { nonce: string }>('SELECT nonce FROM oidc_flows WHERE state = ?')
    .get(started.state);
  issuer.tokenResponse = {
    status: 200,
    body: { id_token: issuer.sign(idClaims(issuer, flow?.nonce ?? '', claims)) },
  };
  return started;
}

describe('oidcConfigFrom', () => {
  it('reads a complete configuration, and nothing less', () => {
    const complete = {
      AUTH_OIDC_ISSUER: 'https://issuer.invalid/',
      AUTH_OIDC_CLIENT_ID: 'a-client-id',
      AUTH_OIDC_CLIENT_SECRET: 'a-secret',
      AUTH_OIDC_REDIRECT_URI: 'http://127.0.0.1:5174/api/auth/oidc/callback',
    };
    expect(oidcConfigFrom(complete)).toMatchObject({
      issuer: 'https://issuer.invalid',
      clientId: 'a-client-id',
    });
    for (const missing of Object.keys(complete)) {
      expect(oidcConfigFrom({ ...complete, [missing]: '' })).toBeUndefined();
    }
    expect(oidcConfigFrom({})).toBeUndefined();
  });

  it('takes a label and scopes when they are given', () => {
    expect(
      oidcConfigFrom({
        AUTH_OIDC_ISSUER: 'https://issuer.invalid',
        AUTH_OIDC_CLIENT_ID: 'a-client-id',
        AUTH_OIDC_CLIENT_SECRET: 'a-secret',
        AUTH_OIDC_REDIRECT_URI: 'http://127.0.0.1:5174/cb',
        AUTH_OIDC_LABEL: 'Sign in with Acme',
        AUTH_OIDC_SCOPES: 'openid email',
      }),
    ).toMatchObject({ label: 'Sign in with Acme', scopes: 'openid email' });
  });
});

describe('begin', () => {
  it('sends the browser to the issuer with everything the flow needs', async () => {
    const { url, state } = await oidc.begin('/parts');
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(`${issuer.issuer}/authorize`);
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('client_id')).toBe(issuer.clientId);
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('scope')).toBe('openid email profile');
    expect(parsed.searchParams.get('state')).toBe(state);
    expect(parsed.searchParams.get('nonce')).not.toBeNull();
  });

  it('keeps the handshake in the database, not in the address', async () => {
    const { url, state } = await oidc.begin('/parts');
    expect(url).not.toContain('code_verifier');
    const flow = store.db.raw
      .prepare<[string], { code_verifier: string; redirect_to: string }>(
        'SELECT code_verifier, redirect_to FROM oidc_flows WHERE state = ?',
      )
      .get(state);
    expect(flow?.code_verifier).toBeDefined();
    expect(flow?.redirect_to).toBe('/parts');
  });

  it('sweeps handshakes nobody came back from', async () => {
    const first = await oidc.begin('/');
    now = new Date('2026-09-12T09:10:00.000Z');
    await oidc.begin('/');
    expect(store.flows.take(first.state)).toBeUndefined();
  });

  it('says what the button should read', () => {
    expect(oidc.configured()).toBe(true);
    expect(oidc.label()).toBe('Sign in with issuer.invalid');
    const named = createOidc({
      config: {
        issuer: issuer.issuer,
        clientId: issuer.clientId,
        clientSecret: 'a-secret',
        redirectUri: 'http://127.0.0.1:5174/cb',
        label: 'Sign in with Acme',
      },
      store,
      fetch: issuer.fetch,
    });
    expect(named.label()).toBe('Sign in with Acme');
  });
});

describe('complete', () => {
  it('exchanges the code with the verifier and returns who signed in', async () => {
    const started = await handshake();
    const { identity, redirectTo } = await oidc.complete(started.state, 'the-code');
    expect(identity).toStrictEqual({
      issuer: issuer.issuer,
      subject: 'subject-1',
      email: 'gavin@example.com',
      emailVerified: true,
      name: 'Gavin',
    });
    expect(redirectTo).toBe('/parts');
    const exchange = issuer.calls.find((call) => call.url.endsWith('/token'));
    expect(exchange?.body).toContain('grant_type=authorization_code');
    expect(exchange?.body).toContain('code_verifier=');
    expect(exchange?.body).toContain('client_secret=a-client-secret');
  });

  it('will not take the same handshake twice', async () => {
    const started = await handshake();
    await oidc.complete(started.state, 'the-code');
    await expect(oidc.complete(started.state, 'the-code')).rejects.toThrow(
      expect.objectContaining({ code: 'AUTH_OIDC_STATE' }),
    );
  });

  it('refuses a state nobody started', async () => {
    await expect(oidc.complete('invented', 'the-code')).rejects.toThrow(
      expect.objectContaining({ code: 'AUTH_OIDC_STATE' }),
    );
  });

  it('refuses a handshake that took too long', async () => {
    const started = await handshake();
    now = new Date('2026-09-12T09:06:00.000Z');
    await expect(oidc.complete(started.state, 'the-code')).rejects.toThrow(
      expect.objectContaining({ code: 'AUTH_OIDC_STATE' }),
    );
  });

  it('refuses a token signed by something else', async () => {
    const started = await oidc.begin('/');
    const flow = store.db.raw
      .prepare<[string], { nonce: string }>('SELECT nonce FROM oidc_flows WHERE state = ?')
      .get(started.state);
    issuer.tokenResponse = {
      status: 200,
      body: { id_token: issuer.signWithStranger(idClaims(issuer, flow?.nonce ?? '')) },
    };
    await expect(oidc.complete(started.state, 'the-code')).rejects.toThrow(
      expect.objectContaining({ code: 'AUTH_TOKEN_SIGNATURE' }),
    );
  });

  it('refuses a token for another issuer, another client, or another sign-in', async () => {
    for (const [overrides, code] of [
      [{ iss: 'https://elsewhere.invalid' }, 'AUTH_TOKEN_ISSUER'],
      [{ aud: 'another-client' }, 'AUTH_TOKEN_AUDIENCE'],
      [{ nonce: 'a different sign-in' }, 'AUTH_TOKEN_NONCE'],
      [{ exp: Math.floor(Date.parse('2026-09-12T08:00:00.000Z') / 1000) }, 'AUTH_TOKEN_EXPIRED'],
      [{ sub: '' }, 'AUTH_TOKEN_UNREADABLE'],
    ] as const) {
      const started = await handshake(overrides);
      await expect(oidc.complete(started.state, 'the-code')).rejects.toThrow(
        expect.objectContaining({ code }),
      );
    }
  });

  it('refuses when the issuer publishes no key for the token', async () => {
    const started = await handshake();
    issuer.publish([]);
    await expect(oidc.complete(started.state, 'the-code')).rejects.toThrow(
      expect.objectContaining({ code: 'AUTH_TOKEN_KEY_UNKNOWN' }),
    );
  });

  it('refuses when the provider will not exchange the code', async () => {
    const started = await handshake();
    issuer.tokenResponse = { status: 400, body: { error: 'invalid_grant' } };
    await expect(oidc.complete(started.state, 'the-code')).rejects.toThrow(
      expect.objectContaining({ code: 'AUTH_OIDC_PROVIDER' }),
    );
  });

  it('refuses when the provider sends no ID token at all', async () => {
    const started = await handshake();
    issuer.tokenResponse = { status: 200, body: { access_token: 'only-this' } };
    await expect(oidc.complete(started.state, 'the-code')).rejects.toThrow(
      expect.objectContaining({ code: 'AUTH_OIDC_PROVIDER' }),
    );
  });

  it('takes an unverified email as no email at all', async () => {
    const started = await handshake({ email_verified: false, name: 42 });
    const { identity } = await oidc.complete(started.state, 'the-code');
    expect(identity.emailVerified).toBe(false);
    expect(identity.name).toBeUndefined();
  });
});

describe('what the issuer says about itself', () => {
  it('is read once and kept for a while', async () => {
    await oidc.begin('/');
    await oidc.begin('/');
    const discoveries = issuer.calls.filter((call) => call.url.includes('openid-configuration'));
    expect(discoveries).toHaveLength(1);
  });

  it('is read again once it is stale', async () => {
    await oidc.begin('/');
    now = new Date('2026-09-12T09:20:00.000Z');
    await oidc.begin('/');
    expect(issuer.calls.filter((call) => call.url.includes('openid-configuration'))).toHaveLength(
      2,
    );
  });

  it('is refused when it is unusable, or not JSON at all', async () => {
    const broken = createOidc({
      config: {
        issuer: 'https://broken.invalid',
        clientId: 'a-client-id',
        clientSecret: 'a-secret',
        redirectUri: 'http://127.0.0.1:5174/cb',
      },
      store,
      fetch: (() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ issuer: 'https://broken.invalid' }),
        })) as unknown as typeof fetch,
      clock: () => now,
    });
    await expect(broken.begin('/')).rejects.toThrow(
      expect.objectContaining({ code: 'AUTH_OIDC_PROVIDER' }),
    );

    const notJson = createOidc({
      config: {
        issuer: 'https://broken.invalid',
        clientId: 'a-client-id',
        clientSecret: 'a-secret',
        redirectUri: 'http://127.0.0.1:5174/cb',
      },
      store,
      fetch: (() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.reject(new Error('not JSON')),
        })) as unknown as typeof fetch,
      clock: () => now,
    });
    await expect(notJson.begin('/')).rejects.toThrow(
      expect.objectContaining({ code: 'AUTH_OIDC_PROVIDER' }),
    );
  });

  it('keeps the keys too, and asks again when they are stale', async () => {
    const first = await handshake();
    await oidc.complete(first.state, 'the-code');
    const second = await handshake();
    await oidc.complete(second.state, 'the-code');
    expect(issuer.calls.filter((call) => call.url.endsWith('/jwks'))).toHaveLength(1);
    now = new Date('2026-09-12T09:20:00.000Z');
    const third = await handshake();
    await oidc.complete(third.state, 'the-code');
    expect(issuer.calls.filter((call) => call.url.endsWith('/jwks'))).toHaveLength(2);
  });

  it('copes with a key set that has no keys in it at all', async () => {
    const started = await handshake();
    const withoutKeys = createOidc({
      config: {
        issuer: issuer.issuer,
        clientId: issuer.clientId,
        clientSecret: 'a-client-secret',
        redirectUri: 'http://127.0.0.1:5174/cb',
      },
      store,
      clock: () => now,
      random,
      fetch: ((url: string, init?: RequestInit) =>
        url.endsWith('/jwks')
          ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response)
          : issuer.fetch(url, init)) as unknown as typeof fetch,
    });
    await expect(withoutKeys.complete(started.state, 'the-code')).rejects.toThrow(
      expect.objectContaining({ code: 'AUTH_TOKEN_KEY_UNKNOWN' }),
    );
  });

  it('reads the wall clock and makes its own random when given neither', async () => {
    const plain = createOidc({
      config: {
        issuer: issuer.issuer,
        clientId: issuer.clientId,
        clientSecret: 'a-secret',
        redirectUri: 'http://127.0.0.1:5174/cb',
      },
      store,
      fetch: issuer.fetch,
    });
    expect(plain.configured()).toBe(true);
    expect(plain.label()).toBe('Sign in with issuer.invalid');
    const { state } = await plain.begin('/');
    const flow = store.flows.take(state);
    expect(Date.parse(flow?.createdAt ?? '')).toBeGreaterThan(Date.now() - 60_000);
  });

  it('uses the runtime\u2019s own fetch when it is given none', () => {
    const plain = createOidc({
      config: {
        issuer: issuer.issuer,
        clientId: issuer.clientId,
        clientSecret: 'a-secret',
        redirectUri: 'http://127.0.0.1:5174/cb',
      },
      store,
    });
    expect(plain.configured()).toBe(true);
  });

  it('has no email to offer when the token carries none', async () => {
    const started = await handshake({ email: undefined, email_verified: undefined });
    const { identity } = await oidc.complete(started.state, 'the-code');
    expect(identity.email).toBeUndefined();
    expect(identity.emailVerified).toBe(false);
  });
});
