import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { WebError } from './errors.js';

/** The cookie the browser holds once it has been let in with the token. */
export const SESSION_COOKIE = 'chip_session';
/** The header a state-changing request must repeat the token in. */
export const TOKEN_HEADER = 'x-chip-token';

export const LOOPBACK_HOSTS: readonly string[] = Object.freeze([
  '127.0.0.1',
  '::1',
  'localhost',
  '[::1]',
]);

export interface RequestFactsForAuth {
  readonly method: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  /** The request URL's query string, already parsed. */
  readonly query: URLSearchParams;
}

export type AuthVia = 'cookie' | 'bearer' | 'query' | 'none';

export interface AuthResult {
  readonly authenticated: boolean;
  readonly via: AuthVia;
}

/** A fresh token per start. 32 bytes is 256 bits; nothing here is guessable. */
export function mintToken(random: (size: number) => Buffer = randomBytes): string {
  return random(32).toString('base64url');
}

/** Constant-time comparison over digests, so neither value's length leaks. */
export function sameToken(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

export function parseCookies(header: string | undefined): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) {
      continue;
    }
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name !== '') {
      out[name] = decodeURIComponent(value);
    }
  }
  return out;
}

function headerOf(request: RequestFactsForAuth, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function isLoopback(host: string): boolean {
  return LOOPBACK_HOSTS.includes(host);
}

/**
 * The warning printed when the server is told to listen somewhere other than
 * the loopback interface. It is a sentence rather than a flag because the
 * person typing `--host 0.0.0.0` has just put a button that spends money on
 * their local network, and should read that in words (D67).
 */
export function bindWarning(host: string): string | undefined {
  return isLoopback(host)
    ? undefined
    : `listening on ${host}, not the loopback interface: anyone who can reach this address and holds the token can read the data, change it, and start runs that cost money`;
}

export interface SecurityOptions {
  readonly token: string;
  /** Origins allowed to make state-changing requests. Built from the bind address and port. */
  readonly origins: readonly string[];
}

export interface Security {
  readonly token: string;
  authenticate(request: RequestFactsForAuth): AuthResult;
  /** Throws 401 unless the request carries the token by any accepted route. */
  requireRead(request: RequestFactsForAuth): AuthResult;
  /**
   * Throws unless the request may change state: authenticated, from an origin
   * this server serves, and carrying the token in a header rather than only
   * in a cookie.
   */
  requireWrite(request: RequestFactsForAuth): void;
  /** The `Set-Cookie` value that admits a browser that arrived with the token. */
  sessionCookie(): string;
  /** Whether an origin may make state-changing requests. */
  allowsOrigin(origin: string): boolean;
}

export function originsFor(host: string, port: number): readonly string[] {
  const hosts = isLoopback(host) ? ['127.0.0.1', 'localhost', '[::1]'] : [host];
  return hosts.map((name) => `http://${name}:${String(port)}`);
}

export function createSecurity(options: SecurityOptions): Security {
  const { token, origins } = options;

  const authenticate = (request: RequestFactsForAuth): AuthResult => {
    const authorization = headerOf(request, 'authorization');
    if (authorization?.startsWith('Bearer ') === true) {
      return { authenticated: sameToken(authorization.slice(7), token), via: 'bearer' };
    }
    const cookie = parseCookies(headerOf(request, 'cookie'))[SESSION_COOKIE];
    if (cookie !== undefined) {
      return { authenticated: sameToken(cookie, token), via: 'cookie' };
    }
    const query = request.query.get('token');
    if (query !== null) {
      return { authenticated: sameToken(query, token), via: 'query' };
    }
    return { authenticated: false, via: 'none' };
  };

  const allowsOrigin = (origin: string): boolean => origins.includes(origin);

  return {
    token,
    authenticate,
    allowsOrigin,

    requireRead(request) {
      const result = authenticate(request);
      if (!result.authenticated) {
        throw new WebError(401, 'WEB_UNAUTHENTICATED', 'this request carries no valid token', {
          details: { via: result.via },
        });
      }
      return result;
    },

    requireWrite(request) {
      const result = this.requireRead(request);
      const origin = headerOf(request, 'origin');
      if (origin !== undefined && !allowsOrigin(origin)) {
        throw new WebError(403, 'WEB_ORIGIN_REFUSED', `origin ${origin} may not change anything`, {
          details: { origin },
        });
      }
      if (result.via === 'cookie') {
        const header = headerOf(request, TOKEN_HEADER);
        if (header === undefined || !sameToken(header, token)) {
          throw new WebError(
            403,
            'WEB_TOKEN_HEADER_REQUIRED',
            `a request that changes state must repeat the token in ${TOKEN_HEADER}`,
          );
        }
      }
    },

    sessionCookie() {
      return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict`;
    },
  };
}
