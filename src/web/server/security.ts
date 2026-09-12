import { mayWrite, type Account } from '../../auth/account.js';
import { sameSecret, type AuthService } from '../../auth/service.js';
import { CSRF_COOKIE, SESSION_COOKIE } from '../../auth/sessions.js';
import { WebError } from './errors.js';

/**
 * Who is asking, and whether they may.
 *
 * A session cookie identifies the account; a header repeating the readable
 * half of the pair proves the request came from this site's own page rather
 * than someone else's (the double-submit pattern, D67); an origin check
 * refuses a page served from anywhere else; and the account's role decides
 * whether a change is allowed at all (D76).
 *
 * There is no token in an address any more, and no shared secret: a browser
 * either holds a session this server issued, or it signs in (D75).
 */

export { CSRF_COOKIE, SESSION_COOKIE };

/** The header a state-changing request must repeat the CSRF value in. */
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

export interface Caller {
  readonly account: Account;
  /** The CSRF value this session was issued with. */
  readonly csrf: string;
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

export function headerOf(request: RequestFactsForAuth, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function sessionCookieOf(request: RequestFactsForAuth): string | undefined {
  return parseCookies(headerOf(request, 'cookie'))[SESSION_COOKIE];
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
    : `listening on ${host}, not the loopback interface: anyone who can reach this address and has an account can read the data, change it, and start runs that cost money`;
}

export function originsFor(host: string, port: number): readonly string[] {
  const hosts = isLoopback(host) ? ['127.0.0.1', 'localhost', '[::1]'] : [host];
  return hosts.map((name) => `http://${name}:${String(port)}`);
}

export interface SecurityOptions {
  readonly auth: AuthService;
  /** Origins allowed to make state-changing requests. Built from the bind address and port. */
  readonly origins: readonly string[];
  /** True when the cookies should carry `Secure`, which loopback HTTP cannot. */
  readonly secureCookies?: boolean;
}

export interface Security {
  /** Who is asking, or undefined when nobody is signed in. */
  caller(request: RequestFactsForAuth): Caller | undefined;
  /** Throws 401 unless a valid session is attached. */
  requireRead(request: RequestFactsForAuth): Caller;
  /** Throws unless the caller may change something: session, origin, header, role. */
  requireWrite(request: RequestFactsForAuth): Caller;
  /** The `Set-Cookie` values for a session that has just been issued. */
  cookiesFor(cookie: string, csrf: string): readonly string[];
  /** The `Set-Cookie` values that clear a session. */
  clearedCookies(): readonly string[];
  allowsOrigin(origin: string): boolean;
}

export function createSecurity(options: SecurityOptions): Security {
  const { auth, origins } = options;
  const secure = options.secureCookies === true ? '; Secure' : '';
  const allowsOrigin = (origin: string): boolean => origins.includes(origin);

  const caller = (request: RequestFactsForAuth): Caller | undefined => {
    const resolved = auth.resolve(sessionCookieOf(request));
    return resolved === undefined
      ? undefined
      : { account: resolved.account, csrf: resolved.session.csrf };
  };

  const requireRead = (request: RequestFactsForAuth): Caller => {
    const found = caller(request);
    if (found === undefined) {
      throw new WebError(401, 'WEB_UNAUTHENTICATED', 'this request carries no valid session');
    }
    return found;
  };

  return {
    caller,
    requireRead,
    allowsOrigin,

    requireWrite(request) {
      const found = requireRead(request);
      const origin = headerOf(request, 'origin');
      if (origin !== undefined && !allowsOrigin(origin)) {
        throw new WebError(403, 'WEB_ORIGIN_REFUSED', `origin ${origin} may not change anything`, {
          details: { origin },
        });
      }
      const header = headerOf(request, TOKEN_HEADER);
      if (header === undefined || !sameSecret(header, found.csrf)) {
        throw new WebError(
          403,
          'WEB_TOKEN_HEADER_REQUIRED',
          `a request that changes state must repeat this session's token in ${TOKEN_HEADER}`,
        );
      }
      if (!mayWrite(found.account.role)) {
        throw new WebError(
          403,
          'WEB_ROLE_INSUFFICIENT',
          `${found.account.username} may read this site but not change it`,
          { details: { role: found.account.role } },
        );
      }
      return found;
    },

    cookiesFor(cookie, csrf) {
      return [
        `${SESSION_COOKIE}=${encodeURIComponent(cookie)}; Path=/; HttpOnly; SameSite=Strict${secure}`,
        `${CSRF_COOKIE}=${encodeURIComponent(csrf)}; Path=/; SameSite=Strict${secure}`,
      ];
    },

    clearedCookies() {
      return [
        `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=0`,
        `${CSRF_COOKIE}=; Path=/; SameSite=Strict${secure}; Max-Age=0`,
      ];
    },
  };
}
