import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAuthService, type AuthService } from '../../auth/service.js';
import { createAuthStore, type AuthStore } from '../../auth/store.js';
import type { Account } from '../../auth/account.js';
import {
  TOKEN_HEADER,
  bindWarning,
  createSecurity,
  isLoopback,
  originsFor,
  parseCookies,
  sessionCookieOf,
  type RequestFactsForAuth,
  type Security,
} from './security.js';

/**
 * Who the server lets in, and what it lets them do.
 *
 * There is no shared token any more: a request either carries a session this
 * server issued, or it does not (D75). A change needs three more things — an
 * origin this server serves, the session's own value repeated in a header,
 * and an account that may write (D67, D76).
 */

let store: AuthStore;
let auth: AuthService;
let security: Security;
let admin: Account;
let viewer: Account;

beforeEach(() => {
  store = createAuthStore(':memory:');
  auth = createAuthService({ store });
  security = createSecurity({ auth, origins: originsFor('127.0.0.1', 5174) });
  admin = store.accounts.create({ username: 'gavin', role: 'admin' });
  viewer = store.accounts.create({ username: 'onlooker', role: 'viewer' });
});

afterEach(() => {
  store.close();
});

function request(
  headers: Record<string, string | string[] | undefined>,
  method = 'GET',
): RequestFactsForAuth {
  return { method, headers, query: new URLSearchParams() };
}

function signedIn(account: Account): { cookie: string; csrf: string } {
  const issued = auth.signInAs(account);
  return { cookie: issued.cookie, csrf: issued.csrf };
}

describe('parseCookies', () => {
  it('reads a cookie header, and shrugs at nonsense in it', () => {
    expect(parseCookies('chip_session=abc; chip_csrf=def')).toStrictEqual({
      chip_session: 'abc',
      chip_csrf: 'def',
    });
    expect(parseCookies('=novalue; ; broken; a=b')).toStrictEqual({ a: 'b' });
    // A name that is only spaces is not a name.
    expect(parseCookies(' =b; a=c')).toStrictEqual({ a: 'c' });
    expect(parseCookies(undefined)).toStrictEqual({});
    expect(parseCookies('encoded=a%20b')).toStrictEqual({ encoded: 'a b' });
  });

  it('picks the session out of the header, when there is one', () => {
    expect(sessionCookieOf(request({ cookie: 'chip_session=abc' }))).toBe('abc');
    expect(sessionCookieOf(request({}))).toBeUndefined();
  });
});

describe('caller', () => {
  it('is whoever the session belongs to', () => {
    const { cookie } = signedIn(admin);
    expect(security.caller(request({ cookie: `chip_session=${cookie}` }))?.account.username).toBe(
      'gavin',
    );
  });

  it('is nobody without a cookie, with an unknown one, or after signing out', () => {
    const { cookie } = signedIn(admin);
    expect(security.caller(request({}))).toBeUndefined();
    expect(security.caller(request({ cookie: 'chip_session=nothing' }))).toBeUndefined();
    auth.signOut(cookie);
    expect(security.caller(request({ cookie: `chip_session=${cookie}` }))).toBeUndefined();
  });

  it('ignores a header that used to be accepted', () => {
    const { cookie } = signedIn(admin);
    // A bearer token and a token in the query were how this worked before
    // D75. Neither is a way in now.
    expect(security.caller(request({ authorization: `Bearer ${cookie}` }))).toBeUndefined();
    expect(
      security.caller({
        method: 'GET',
        headers: {},
        query: new URLSearchParams(`token=${cookie}`),
      }),
    ).toBeUndefined();
  });

  it('takes the first of a repeated header, rather than an array', () => {
    const { cookie } = signedIn(admin);
    expect(
      security.caller(request({ cookie: [`chip_session=${cookie}`, 'chip_session=other'] })),
    ).toBeDefined();
  });
});

describe('requireRead', () => {
  it('lets a signed-in account through, whatever its role', () => {
    for (const account of [admin, viewer]) {
      const { cookie } = signedIn(account);
      expect(security.requireRead(request({ cookie: `chip_session=${cookie}` }))).toBeDefined();
    }
  });

  it('refuses with 401 when nobody is signed in', () => {
    expect(() => security.requireRead(request({}))).toThrow(
      expect.objectContaining({ code: 'WEB_UNAUTHENTICATED', status: 401 }),
    );
  });
});

describe('requireWrite', () => {
  it('needs the session, the header and the role', () => {
    const { cookie, csrf } = signedIn(admin);
    const headers = { cookie: `chip_session=${cookie}`, [TOKEN_HEADER]: csrf };
    expect(security.requireWrite(request(headers, 'POST')).account.username).toBe('gavin');
  });

  it('refuses a cookie alone: a form on another site has one too', () => {
    const { cookie } = signedIn(admin);
    expect(() =>
      security.requireWrite(request({ cookie: `chip_session=${cookie}` }, 'POST')),
    ).toThrow(expect.objectContaining({ code: 'WEB_TOKEN_HEADER_REQUIRED', status: 403 }));
  });

  it('refuses another session’s token in the header', () => {
    const { cookie } = signedIn(admin);
    const other = signedIn(admin);
    expect(() =>
      security.requireWrite(
        request({ cookie: `chip_session=${cookie}`, [TOKEN_HEADER]: other.csrf }, 'POST'),
      ),
    ).toThrow(expect.objectContaining({ code: 'WEB_TOKEN_HEADER_REQUIRED' }));
  });

  it('refuses an origin it does not serve', () => {
    const { cookie, csrf } = signedIn(admin);
    expect(() =>
      security.requireWrite(
        request(
          {
            cookie: `chip_session=${cookie}`,
            [TOKEN_HEADER]: csrf,
            origin: 'https://evil.example',
          },
          'POST',
        ),
      ),
    ).toThrow(expect.objectContaining({ code: 'WEB_ORIGIN_REFUSED', status: 403 }));
    expect(security.allowsOrigin('http://127.0.0.1:5174')).toBe(true);
    expect(security.allowsOrigin('http://localhost:5174')).toBe(true);
  });

  it('accepts an origin it does serve', () => {
    const { cookie, csrf } = signedIn(admin);
    expect(
      security.requireWrite(
        request(
          {
            cookie: `chip_session=${cookie}`,
            [TOKEN_HEADER]: csrf,
            origin: 'http://127.0.0.1:5174',
          },
          'POST',
        ),
      ),
    ).toBeDefined();
  });

  it('refuses a viewer, who may read everything and change nothing', () => {
    const { cookie, csrf } = signedIn(viewer);
    expect(() =>
      security.requireWrite(
        request({ cookie: `chip_session=${cookie}`, [TOKEN_HEADER]: csrf }, 'POST'),
      ),
    ).toThrow(expect.objectContaining({ code: 'WEB_ROLE_INSUFFICIENT', status: 403 }));
  });

  it('refuses when nobody is signed in at all', () => {
    expect(() => security.requireWrite(request({}, 'POST'))).toThrow(
      expect.objectContaining({ code: 'WEB_UNAUTHENTICATED' }),
    );
  });
});

describe('cookies', () => {
  it('sets one for the server and one for the page', () => {
    const [session, csrf] = security.cookiesFor('the-cookie', 'the-csrf');
    expect(session).toBe('chip_session=the-cookie; Path=/; HttpOnly; SameSite=Strict');
    expect(csrf).toBe('chip_csrf=the-csrf; Path=/; SameSite=Strict');
  });

  it('marks them Secure where the connection can carry it', () => {
    const overTls = createSecurity({ auth, origins: [], secureCookies: true });
    expect(overTls.cookiesFor('a', 'b').join(' ')).toContain('Secure');
  });

  it('clears both when signing out', () => {
    expect(security.clearedCookies().every((one) => one.includes('Max-Age=0'))).toBe(true);
  });
});

describe('the bind address', () => {
  it('knows the loopback interface by every name it answers to', () => {
    for (const host of ['127.0.0.1', '::1', 'localhost', '[::1]']) {
      expect(isLoopback(host)).toBe(true);
    }
    expect(isLoopback('0.0.0.0')).toBe(false);
  });

  it('says in a sentence what listening elsewhere means', () => {
    expect(bindWarning('127.0.0.1')).toBeUndefined();
    expect(bindWarning('0.0.0.0')).toMatch(/starts runs that cost money|costs? money/iu);
  });

  it('serves the loopback names on the port it was given', () => {
    expect(originsFor('127.0.0.1', 5174)).toStrictEqual([
      'http://127.0.0.1:5174',
      'http://localhost:5174',
      'http://[::1]:5174',
    ]);
    expect(originsFor('10.0.0.5', 80)).toStrictEqual(['http://10.0.0.5:80']);
  });
});
