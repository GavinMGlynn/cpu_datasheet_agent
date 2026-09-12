import { describe, expect, it } from 'vitest';

import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  TOKEN_HEADER,
  bindWarning,
  createSecurity,
  isLoopback,
  mintToken,
  originsFor,
  parseCookies,
  sameToken,
  type RequestFactsForAuth,
} from './security.js';

const TOKEN = 'tokentokentokentoken';
const security = createSecurity({ token: TOKEN, origins: originsFor('127.0.0.1', 5174) });

function request(
  headers: Record<string, string | string[] | undefined>,
  query = '',
  method = 'GET',
): RequestFactsForAuth {
  return { method, headers, query: new URLSearchParams(query) };
}

describe('mintToken', () => {
  it('makes a url-safe token of 256 bits', () => {
    expect(mintToken()).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it('uses the randomness it is given', () => {
    expect(mintToken((size) => Buffer.alloc(size, 0))).toBe('A'.repeat(43));
  });
});

describe('sameToken', () => {
  it('compares without leaking length', () => {
    expect(sameToken('abc', 'abc')).toBe(true);
    expect(sameToken('abc', 'abcd')).toBe(false);
  });
});

describe('parseCookies', () => {
  it('reads names and values, decoding what was encoded', () => {
    expect(parseCookies('a=1; b=two%20words')).toStrictEqual({ a: '1', b: 'two words' });
  });

  it('ignores nonsense rather than failing', () => {
    expect(parseCookies(undefined)).toStrictEqual({});
    expect(parseCookies('novalue; =empty; =; a=1')).toStrictEqual({ a: '1' });
  });
});

describe('bind address', () => {
  it('knows the loopback names', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('0.0.0.0')).toBe(false);
  });

  it('warns in a sentence about a wider bind', () => {
    expect(bindWarning('localhost')).toBeUndefined();
    expect(bindWarning('0.0.0.0')).toMatch(/costs? money|spend money/u);
  });

  it('allows every loopback spelling of its own origin', () => {
    expect(originsFor('127.0.0.1', 5174)).toStrictEqual([
      'http://127.0.0.1:5174',
      'http://localhost:5174',
      'http://[::1]:5174',
    ]);
    expect(originsFor('192.168.1.10', 80)).toStrictEqual(['http://192.168.1.10:80']);
  });
});

describe('authenticate', () => {
  it('accepts a bearer token and rejects a wrong one', () => {
    expect(security.authenticate(request({ authorization: `Bearer ${TOKEN}` }))).toStrictEqual({
      authenticated: true,
      via: 'bearer',
    });
    expect(security.authenticate(request({ authorization: 'Bearer nope' }))).toStrictEqual({
      authenticated: false,
      via: 'bearer',
    });
  });

  it('accepts the session cookie', () => {
    expect(
      security.authenticate(request({ cookie: `${SESSION_COOKIE}=${TOKEN}` })).authenticated,
    ).toBe(true);
    expect(
      security.authenticate(request({ cookie: `${SESSION_COOKIE}=other` })).authenticated,
    ).toBe(false);
  });

  it('accepts the token in the query, which is how a browser first arrives', () => {
    expect(security.authenticate(request({}, `token=${TOKEN}`))).toStrictEqual({
      authenticated: true,
      via: 'query',
    });
    expect(security.authenticate(request({}, 'token=wrong')).authenticated).toBe(false);
  });

  it('reads a header sent more than once', () => {
    expect(
      security.authenticate(request({ authorization: [`Bearer ${TOKEN}`, 'Bearer other'] }))
        .authenticated,
    ).toBe(true);
  });

  it('reports no credential at all', () => {
    expect(security.authenticate(request({}))).toStrictEqual({
      authenticated: false,
      via: 'none',
    });
    expect(security.authenticate(request({ authorization: 'Basic abc' })).via).toBe('none');
  });
});

describe('requireRead', () => {
  it('passes an authenticated request through', () => {
    expect(security.requireRead(request({ authorization: `Bearer ${TOKEN}` })).via).toBe('bearer');
  });

  it('refuses one with no token', () => {
    expect(() => security.requireRead(request({}))).toThrow(
      expect.objectContaining({ code: 'WEB_UNAUTHENTICATED', status: 401 }),
    );
  });
});

describe('requireWrite', () => {
  const write = (headers: Record<string, string | string[] | undefined>): void => {
    security.requireWrite(request(headers, '', 'POST'));
  };

  it('allows a bearer request, which no other page can forge', () => {
    expect(() => {
      write({ authorization: `Bearer ${TOKEN}`, origin: 'http://localhost:5174' });
    }).not.toThrow();
  });

  it('requires the token header when the cookie is what authenticated it', () => {
    expect(() => {
      write({ cookie: `${SESSION_COOKIE}=${TOKEN}` });
    }).toThrow(expect.objectContaining({ code: 'WEB_TOKEN_HEADER_REQUIRED', status: 403 }));
    expect(() => {
      write({ cookie: `${SESSION_COOKIE}=${TOKEN}`, [TOKEN_HEADER]: 'wrong' });
    }).toThrow(expect.objectContaining({ code: 'WEB_TOKEN_HEADER_REQUIRED' }));
    expect(() => {
      write({ cookie: `${SESSION_COOKIE}=${TOKEN}`, [TOKEN_HEADER]: TOKEN });
    }).not.toThrow();
  });

  it('refuses an origin it does not serve', () => {
    expect(() => {
      write({ authorization: `Bearer ${TOKEN}`, origin: 'https://evil.example' });
    }).toThrow(expect.objectContaining({ code: 'WEB_ORIGIN_REFUSED', status: 403 }));
    expect(security.allowsOrigin('http://127.0.0.1:5174')).toBe(true);
  });

  it('refuses an unauthenticated write before it looks at anything else', () => {
    expect(() => {
      write({ origin: 'https://evil.example' });
    }).toThrow(expect.objectContaining({ code: 'WEB_UNAUTHENTICATED' }));
  });
});

describe('sessionCookies', () => {
  it('sets one cookie a script cannot read and one it must', () => {
    expect(security.sessionCookies()).toStrictEqual([
      `${SESSION_COOKIE}=${TOKEN}; Path=/; HttpOnly; SameSite=Strict`,
      `${CSRF_COOKIE}=${TOKEN}; Path=/; SameSite=Strict`,
    ]);
  });
});
