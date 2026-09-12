import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestApi, type TestApi } from '../../../test/helpers/web-api.js';
import { fakeIssuer, idClaims, type FakeIssuer } from '../../../test/helpers/issuer.js';
import { createOidc } from '../../auth/oidc.js';
import { registerOidc } from './oidc.js';

/**
 * The two addresses single sign-on needs.
 *
 * The identity provider is a fake with real keys, so what is being tested is
 * the site's half: where it sends the browser, what it does with what comes
 * back, and which accounts it will and will not let in (20E.5).
 */

let api: TestApi;
let issuer: FakeIssuer;

async function withIssuer(): Promise<void> {
  api = await createTestApi({
    register: (router, deps) => {
      registerOidc(router, {
        ...deps,
        oidc: createOidc({
          config: {
            issuer: issuer.issuer,
            clientId: issuer.clientId,
            clientSecret: 'a-client-secret',
            redirectUri: 'http://127.0.0.1:5174/api/auth/oidc/callback',
          },
          store: deps.auth.store,
          fetch: issuer.fetch,
          clock: deps.clock,
        }),
      });
    },
  });
}

/** Starts a handshake through the endpoint and prepares the issuer's answer. */
async function handshake(overrides: Record<string, unknown> = {}): Promise<string> {
  const start = await api.get('/api/auth/oidc/start');
  const location = String(start.headers.Location);
  const state = new URL(location).searchParams.get('state') ?? '';
  const nonce = new URL(location).searchParams.get('nonce') ?? '';
  issuer.tokenResponse = {
    status: 200,
    body: { id_token: issuer.sign(idClaims(issuer, nonce, overrides)) },
  };
  return state;
}

beforeEach(() => {
  issuer = fakeIssuer();
});

afterEach(async () => {
  await api.close();
});

describe('without an issuer configured', () => {
  it('has no addresses at all, so the site does not look set up for it', async () => {
    api = await createTestApi({ register: registerOidc });
    expect((await api.get('/api/auth/oidc/start')).status).toBe(404);
    expect((await api.get('/api/auth/oidc/callback?state=a&code=b')).status).toBe(404);
  });
});

describe('GET /api/auth/oidc/start', () => {
  it('sends the browser to the provider', async () => {
    await withIssuer();
    const response = await api.get('/api/auth/oidc/start');
    expect(response.status).toBe(302);
    const location = new URL(String(response.headers.Location));
    expect(location.origin + location.pathname).toBe(`${issuer.issuer}/authorize`);
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(response.headers['Cache-Control']).toBe('no-store');
  });

  it('remembers where the browser was going, and refuses to be pointed elsewhere', async () => {
    await withIssuer();
    await api.get('/api/auth/oidc/start?to=/parts/TPS54331DR');
    expect(api.auth.store.db.raw.prepare('SELECT redirect_to FROM oidc_flows').get()).toMatchObject(
      { redirect_to: '/parts/TPS54331DR' },
    );
    api.auth.store.db.raw.prepare('DELETE FROM oidc_flows').run();
    // An absolute address would be an open redirect: it goes home instead.
    await api.get('/api/auth/oidc/start?to=https://evil.example/steal');
    expect(api.auth.store.db.raw.prepare('SELECT redirect_to FROM oidc_flows').get()).toMatchObject(
      { redirect_to: '/' },
    );
  });
});

describe('GET /api/auth/oidc/callback', () => {
  it('signs in an account bound to that identity', async () => {
    await withIssuer();
    api.auth.store.accounts.bindIdentity(api.accounts.admin.id, issuer.issuer, 'subject-1');
    const state = await handshake();
    const response = await api.get(`/api/auth/oidc/callback?state=${state}&code=the-code`);
    expect(response.status).toBe(303);
    expect(response.headers.Location).toBe('/');
    expect(String(response.headers['Set-Cookie'])).toContain('chip_session=');
  });

  it('binds the identity on the first sign-in, by verified email', async () => {
    await withIssuer();
    const account = api.auth.store.accounts.create({
      username: 'gavin@example.com',
      role: 'viewer',
    });
    const state = await handshake();
    expect((await api.get(`/api/auth/oidc/callback?state=${state}&code=the-code`)).status).toBe(
      303,
    );
    expect(api.auth.store.accounts.byId(account.id)).toMatchObject({
      issuer: issuer.issuer,
      subject: 'subject-1',
    });
  });

  it('refuses an identity nobody has an account for', async () => {
    await withIssuer();
    const state = await handshake();
    const response = await api.get(`/api/auth/oidc/callback?state=${state}&code=the-code`);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: 'AUTH_NO_ACCOUNT' } });
  });

  it('refuses an unverified email, however friendly it looks', async () => {
    await withIssuer();
    api.auth.store.accounts.create({ username: 'gavin@example.com', role: 'admin' });
    const state = await handshake({ email_verified: false });
    expect((await api.get(`/api/auth/oidc/callback?state=${state}&code=the-code`)).status).toBe(
      403,
    );
  });

  it('refuses to move an account from one provider to another', async () => {
    await withIssuer();
    const account = api.auth.store.accounts.create({
      username: 'gavin@example.com',
      role: 'admin',
    });
    api.auth.store.accounts.bindIdentity(account.id, 'https://elsewhere.invalid', 'subject-9');
    const state = await handshake();
    const response = await api.get(`/api/auth/oidc/callback?state=${state}&code=the-code`);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: 'AUTH_NO_ACCOUNT' } });
  });

  it('refuses a disabled account', async () => {
    await withIssuer();
    api.auth.store.accounts.bindIdentity(api.accounts.admin.id, issuer.issuer, 'subject-1');
    api.auth.store.accounts.setDisabled(api.accounts.admin.id, true);
    const state = await handshake();
    expect((await api.get(`/api/auth/oidc/callback?state=${state}&code=the-code`)).status).toBe(
      403,
    );
  });

  it('records the browser that signed in', async () => {
    await withIssuer();
    api.auth.store.accounts.bindIdentity(api.accounts.admin.id, issuer.issuer, 'subject-1');
    const state = await handshake();
    await api.requestAs(
      { 'user-agent': 'a browser' },
      'GET',
      `/api/auth/oidc/callback?state=${state}&code=the-code`,
    );
    const sessions = api.auth.store.sessions.forAccount(api.accounts.admin.id);
    expect(sessions.some((one) => one.userAgent === 'a browser')).toBe(true);
  });

  it('refuses a callback with nothing in it', async () => {
    await withIssuer();
    expect((await api.get('/api/auth/oidc/callback')).status).toBe(400);
  });

  it('refuses a state that was never started', async () => {
    await withIssuer();
    const response = await api.get('/api/auth/oidc/callback?state=invented&code=the-code');
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: 'AUTH_OIDC_STATE' } });
  });
});
