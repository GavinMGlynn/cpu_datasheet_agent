import { z } from 'zod';

import { publicAccount } from '../../auth/account.js';
import {
  MINIMUM_LENGTH,
  checkPassword,
  hashPassword,
  verifyPassword,
} from '../../auth/password.js';
import type { RouteEntry } from '../server/app.js';
import { WebError } from '../server/errors.js';
import type { Router } from '../server/router.js';
import { TOKEN_HEADER, headerOf, sessionCookieOf } from '../server/security.js';
import { sameSecret } from '../../auth/service.js';
import { open, read, type ApiDeps } from './deps.js';
import { required } from '../../util/present.js';

/**
 * Signing in and out.
 *
 * The sign-in endpoint is the only one a browser may reach without a session,
 * and it is the only one that takes a password. Everything it answers is the
 * same whether the account exists or not (20D.2), and the session it issues
 * is a pair of cookies — one HttpOnly for the server, one readable so the
 * page can repeat it in a header (D67).
 */

const Credentials = z.strictObject({
  username: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(400),
});

const NewPassword = z.strictObject({
  current: z.string().min(1).max(400),
  next: z.string().min(MINIMUM_LENGTH).max(400),
});

function addressOf(context: { readonly headers: Record<string, unknown> }): string | undefined {
  const forwarded = context.headers['x-forwarded-for'];
  return typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined;
}

export function registerAuth(router: Router<RouteEntry>, deps: ApiDeps): void {
  const { auth } = deps;

  /** What the sign-in page needs before anyone has signed in. */
  router.get(
    '/api/auth/state',
    open((context) => {
      const caller = context.caller;
      context.respond.json(context.response, context.facts, {
        accounts: auth.accounts(),
        oidc: deps.oidc?.configured() === true,
        oidcLabel: deps.oidc?.label() ?? null,
        signedInAs: caller === undefined ? null : publicAccount(caller.account),
      });
    }),
  );

  router.post(
    '/api/auth/login',
    open(async (context) => {
      const body = await context.json(Credentials, 'these credentials');
      const issued = await auth.signIn(body.username, body.password, {
        ...(headerOf(context, 'user-agent') === undefined
          ? {}
          : { userAgent: headerOf(context, 'user-agent') }),
        ...(addressOf(context) === undefined ? {} : { address: addressOf(context) }),
      });
      deps.logger.info('signed in', { who: issued.account.username });
      context.respond.json(
        context.response,
        context.facts,
        { account: publicAccount(issued.account) },
        {
          headers: { 'Set-Cookie': context.security.cookiesFor(issued.cookie, issued.csrf) },
          policy: 'live',
        },
      );
    }),
  );

  /**
   * Signing out is open on purpose: a session the server has already
   * forgotten still has cookies to clear, and refusing that would leave a
   * browser stuck holding something it cannot use.
   */
  router.post(
    '/api/auth/logout',
    open((context) => {
      const cookie = sessionCookieOf(context);
      const caller = context.caller;
      if (cookie !== undefined && caller !== undefined) {
        requireSessionToken(context, caller.csrf);
        auth.signOut(cookie);
        deps.logger.info('signed out', { who: caller.account.username });
      }
      context.respond.json(
        context.response,
        context.facts,
        { signedOut: true },
        { headers: { 'Set-Cookie': context.security.clearedCookies() }, policy: 'live' },
      );
    }),
  );

  router.post(
    '/api/auth/logout-everywhere',
    read((context) => {
      // A `read` route: the app refused this request already if nobody is
      // signed in, so the caller is there (D23).
      const caller = required(context.caller, 'the caller of a route that needs a session');
      requireSessionToken(context, caller.csrf);
      const ended = auth.signOutEverywhere(caller.account.id);
      context.respond.json(
        context.response,
        context.facts,
        { signedOut: true, sessions: ended },
        { headers: { 'Set-Cookie': context.security.clearedCookies() }, policy: 'live' },
      );
    }),
  );

  /** Changing your own password, which needs the current one. */
  router.post(
    '/api/auth/password',
    read(async (context) => {
      // A `read` route: the app refused this request already if nobody is
      // signed in, so the caller is there (D23).
      const caller = required(context.caller, 'the caller of a route that needs a session');
      requireSessionToken(context, caller.csrf);
      const body = await context.json(NewPassword, 'this password change');
      const stored = auth.store.accounts.passwordHash(caller.account.id);
      if (stored === undefined || !(await verifyPassword(body.current, stored))) {
        throw new WebError(403, 'AUTH_REFUSED', 'that is not the current password');
      }
      checkPassword(body.next);
      auth.store.accounts.setPassword(
        caller.account.id,
        await hashPassword(body.next),
        deps.clock().toISOString(),
      );
      // Every other browser loses its session: a password change that leaves
      // the old ones signed in has not changed anything for whoever had them.
      const ended = auth.signOutEverywhere(caller.account.id);
      const issued = auth.signInAs(caller.account);
      context.respond.json(
        context.response,
        context.facts,
        { changed: true, sessionsEnded: ended },
        {
          headers: { 'Set-Cookie': context.security.cookiesFor(issued.cookie, issued.csrf) },
          policy: 'live',
        },
      );
    }),
  );
}

/** The readable half of the session, repeated in a header (D67). */
function requireSessionToken(context: Parameters<RouteEntry['handler']>[0], csrf: string): void {
  const header = headerOf(context, TOKEN_HEADER);
  if (header === undefined || !sameSecret(header, csrf)) {
    throw new WebError(
      403,
      'WEB_TOKEN_HEADER_REQUIRED',
      `a request that changes state must repeat this session's token in ${TOKEN_HEADER}`,
    );
  }
}
