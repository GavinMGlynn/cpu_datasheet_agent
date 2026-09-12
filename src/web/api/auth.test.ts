import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestApi, type TestApi } from '../../../test/helpers/web-api.js';
import { CURRENT, hashPassword } from '../../auth/password.js';
import { registerAuth } from './auth.js';

/**
 * Signing in over the API.
 *
 * The test store signs in without a password everywhere else; here the
 * password path is the thing under test, so the accounts get real hashes —
 * at a weaker cost, because what is being checked is the endpoint, not
 * scrypt.
 */

const PASSWORD = 'correct horse battery staple';
const weak = { ...CURRENT, cost: 1024 };

let api: TestApi;

beforeEach(async () => {
  api = await createTestApi({ register: registerAuth });
  api.auth.store.accounts.setPassword(
    api.accounts.admin.id,
    await hashPassword(PASSWORD, { parameters: weak }),
  );
  api.auth.store.accounts.setPassword(
    api.accounts.viewer.id,
    await hashPassword(PASSWORD, { parameters: weak }),
  );
});

afterEach(async () => {
  await api.close();
});

/** A request with no session at all, the way the sign-in page sends one. */
function anonymous(url: string, body?: unknown) {
  return api.requestAs({}, 'POST', url, body);
}

describe('GET /api/auth/state', () => {
  it('says how many accounts there are, and who is signed in', async () => {
    const response = await api.get('/api/auth/state');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      accounts: 2,
      oidc: false,
      signedInAs: { username: 'tester', role: 'admin' },
    });
  });

  it('answers a browser nobody has signed in', async () => {
    const response = await api.requestAs({}, 'GET', '/api/auth/state');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ accounts: 2, signedInAs: null });
  });
});

describe('POST /api/auth/login', () => {
  it('takes a username and a password and hands back a session', async () => {
    const response = await anonymous('/api/auth/login', {
      username: 'tester',
      password: PASSWORD,
    });
    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({
      account: { username: 'tester', displayName: 'tester', role: 'admin' },
    });
    const cookies = response.headers['Set-Cookie'] as readonly string[];
    expect(cookies[0]).toContain('chip_session=');
    expect(cookies[0]).toContain('HttpOnly');
    expect(cookies[1]).toContain('chip_csrf=');
    expect(cookies[1]).not.toContain('HttpOnly');
  });

  it('refuses the wrong password, and an account that does not exist, alike', async () => {
    const wrong = await anonymous('/api/auth/login', { username: 'tester', password: 'nope' });
    const missing = await anonymous('/api/auth/login', { username: 'nobody', password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.body).toStrictEqual(missing.body);
  });

  it('refuses a body that is not a pair of credentials', async () => {
    const response = await anonymous('/api/auth/login', { username: 'tester' });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('stops answering after enough wrong ones', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await anonymous('/api/auth/login', { username: 'tester', password: 'nope' });
    }
    const response = await anonymous('/api/auth/login', {
      username: 'tester',
      password: PASSWORD,
    });
    expect(response.status).toBe(429);
    expect(response.body).toMatchObject({ error: { code: 'AUTH_LOCKED_OUT' } });
  });

  it('records what the browser was, for the session list', async () => {
    await api.requestAs(
      { 'user-agent': 'a browser', 'x-forwarded-for': '10.0.0.1, 10.0.0.2' },
      'POST',
      '/api/auth/login',
      { username: 'tester', password: PASSWORD },
    );
    const stored = api.auth.store.sessions.forAccount(api.accounts.admin.id);
    expect(stored.some((one) => one.userAgent === 'a browser' && one.address === '10.0.0.1')).toBe(
      true,
    );
  });
});

describe('POST /api/auth/logout', () => {
  it('ends the session and clears both cookies', async () => {
    const response = await api.post('/api/auth/logout');
    expect(response.status).toBe(200);
    expect((response.headers['Set-Cookie'] as readonly string[]).join(' ')).toContain('Max-Age=0');
    expect(api.auth.resolve(api.session.cookie)).toBeUndefined();
  });

  it('clears the cookies of a browser holding a session nobody has', async () => {
    const response = await api.requestAs(
      { cookie: 'chip_session=nothing-the-server-knows' },
      'POST',
      '/api/auth/logout',
    );
    expect(response.status).toBe(200);
    expect((response.headers['Set-Cookie'] as readonly string[]).join(' ')).toContain('Max-Age=0');
  });

  it('refuses a sign-out that does not repeat the session’s token', async () => {
    const response = await api.requestAs(
      { cookie: `chip_session=${api.session.cookie}` },
      'POST',
      '/api/auth/logout',
    );
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: 'WEB_TOKEN_HEADER_REQUIRED' } });
  });
});

describe('POST /api/auth/logout-everywhere', () => {
  it('ends every session the account has', async () => {
    const other = api.auth.signInAs(api.accounts.admin);
    const response = await api.post('/api/auth/logout-everywhere');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ signedOut: true });
    expect(api.auth.resolve(other.cookie)).toBeUndefined();
  });

  it('refuses when nobody is signed in', async () => {
    const response = await api.requestAs({}, 'POST', '/api/auth/logout-everywhere');
    expect(response.status).toBe(401);
  });

  it('refuses without the session’s own token', async () => {
    const response = await api.requestAs(
      { cookie: `chip_session=${api.session.cookie}` },
      'POST',
      '/api/auth/logout-everywhere',
    );
    expect(response.status).toBe(403);
  });
});

describe('POST /api/auth/password', () => {
  it('changes it, ends every other session, and keeps this one', async () => {
    const other = api.auth.signInAs(api.accounts.admin);
    const response = await api.post('/api/auth/password', {
      current: PASSWORD,
      next: 'a whole new passphrase',
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ changed: true });
    expect(api.auth.resolve(other.cookie)).toBeUndefined();
    // The browser that changed it keeps working, on the session it was handed.
    const cookies = response.headers['Set-Cookie'] as readonly string[];
    expect(cookies[0]).toContain('chip_session=');
    await expect(api.auth.signIn('tester', 'a whole new passphrase')).resolves.toBeDefined();
  });

  it('needs the current password, not just a session', async () => {
    const response = await api.post('/api/auth/password', {
      current: 'not the password',
      next: 'a whole new passphrase',
    });
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: 'AUTH_REFUSED' } });
  });

  it('refuses a new password the policy would not store', async () => {
    const response = await api.post('/api/auth/password', { current: PASSWORD, next: 'short' });
    expect(response.status).toBe(400);
  });

  it('refuses an account that had no password to begin with', async () => {
    api.auth.store.accounts.setPassword(api.accounts.admin.id, null);
    const response = await api.post('/api/auth/password', {
      current: PASSWORD,
      next: 'a whole new passphrase',
    });
    expect(response.status).toBe(403);
  });

  it('refuses when nobody is signed in, and without the token', async () => {
    expect(
      (
        await api.requestAs({}, 'POST', '/api/auth/password', {
          current: PASSWORD,
          next: 'a whole new passphrase',
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await api.requestAs(
          { cookie: `chip_session=${api.session.cookie}` },
          'POST',
          '/api/auth/password',
          { current: PASSWORD, next: 'a whole new passphrase' },
        )
      ).status,
    ).toBe(403);
  });
});
