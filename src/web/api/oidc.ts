import { z } from 'zod';

import { publicAccount } from '../../auth/account.js';
import { parseOrThrow } from '../../core/validation-error.js';
import type { OidcIdentity } from '../../auth/oidc.js';
import { sendEmpty } from '../server/respond.js';
import type { RouteEntry } from '../server/app.js';
import { WebError } from '../server/errors.js';
import type { Router } from '../server/router.js';
import { headerOf } from '../server/security.js';
import { open, type ApiDeps } from './deps.js';

/**
 * Signing in through an identity provider.
 *
 * Two addresses: one that sends the browser out, one it comes back to. Both
 * answer 404 when no issuer is configured, because a site that is not set up
 * for single sign-on should not look as though it is.
 *
 * An identity is matched to an account by issuer and subject, or bound on
 * first use to an account whose username is the verified email. There is no
 * self-registration: an admin makes accounts (20E.5).
 */

const Callback = z.strictObject({
  state: z.string().min(1).max(400),
  code: z.string().min(1).max(2000),
});

function accountFor(deps: ApiDeps, identity: OidcIdentity) {
  const accounts = deps.auth.store.accounts;
  const bound = accounts.byIdentity(identity.issuer, identity.subject);
  if (bound !== undefined) {
    return bound;
  }
  // Nothing is bound yet: an account whose username is the verified email is
  // the same person, and the first sign-in ties the two together.
  const byEmail =
    identity.emailVerified && identity.email !== undefined
      ? accounts.byUsername(identity.email)
      : undefined;
  if (byEmail === undefined) {
    throw new WebError(
      403,
      'AUTH_NO_ACCOUNT',
      'that identity has no account here; an admin makes one first',
      { details: { issuer: identity.issuer } },
    );
  }
  if (byEmail.issuer !== undefined) {
    throw new WebError(403, 'AUTH_NO_ACCOUNT', 'that account signs in through another provider');
  }
  accounts.bindIdentity(byEmail.id, identity.issuer, identity.subject, deps.clock().toISOString());
  return byEmail;
}

export function registerOidc(router: Router<RouteEntry>, deps: ApiDeps): void {
  const required = (): NonNullable<ApiDeps['oidc']> => {
    if (deps.oidc === undefined) {
      throw new WebError(404, 'AUTH_OIDC_NOT_CONFIGURED', 'this site has no identity provider');
    }
    return deps.oidc;
  };

  router.get(
    '/api/auth/oidc/start',
    open(async (context) => {
      const oidc = required();
      const to = context.query.get('to');
      const { url } = await oidc.begin(to?.startsWith('/') === true ? to : '/');
      sendEmpty(context.response, 302, { Location: url, 'Cache-Control': 'no-store' });
    }),
  );

  router.get(
    '/api/auth/oidc/callback',
    open(async (context) => {
      const oidc = required();
      const { state, code } = parseOrThrow(
        Callback,
        {
          state: context.query.get('state') ?? '',
          code: context.query.get('code') ?? '',
        },
        'this callback',
      );
      const { identity, redirectTo } = await oidc.complete(state, code);
      const account = accountFor(deps, identity);
      if (account.disabledAt !== undefined) {
        throw new WebError(403, 'AUTH_REFUSED', 'that account is disabled');
      }
      const issued = deps.auth.signInAs(account, {
        ...(headerOf(context, 'user-agent') === undefined
          ? {}
          : { userAgent: headerOf(context, 'user-agent') }),
      });
      deps.logger.info('signed in through the identity provider', {
        who: publicAccount(account).username,
        issuer: identity.issuer,
      });
      sendEmpty(context.response, 303, {
        Location: redirectTo,
        'Set-Cookie': context.security.cookiesFor(issued.cookie, issued.csrf),
        'Cache-Control': 'no-store',
      });
    }),
  );
}
