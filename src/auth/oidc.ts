import { randomBytes } from 'node:crypto';

import { ChipAgentError } from '../errors.js';
import { pkce, verifyIdToken, type Jwk } from './jwt.js';
import type { AuthStore } from './store.js';

/**
 * Single sign-on against any OpenID Connect issuer (20E).
 *
 * Written to the specification rather than to one provider: discovery says
 * where the endpoints are, the authorization code is exchanged from the
 * server with PKCE, and the ID token is verified against the issuer's own
 * keys. Nothing here runs when no issuer is configured — this project has to
 * work with no network at all.
 *
 * The handshake in flight lives in the identity database, not in a cookie:
 * a row can be deleted the moment it is used, so a `state` is good once.
 */

export class OidcError extends ChipAgentError {}

export interface OidcConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  /** What the button says. Defaults to the issuer's host. */
  readonly label?: string;
  readonly scopes?: string;
}

/** Reads the configuration from the environment, or says there is none. */
export function oidcConfigFrom(env: NodeJS.ProcessEnv): OidcConfig | undefined {
  const issuer = env.AUTH_OIDC_ISSUER?.trim();
  const clientId = env.AUTH_OIDC_CLIENT_ID?.trim();
  const clientSecret = env.AUTH_OIDC_CLIENT_SECRET?.trim();
  const redirectUri = env.AUTH_OIDC_REDIRECT_URI?.trim();
  if (
    issuer === undefined ||
    issuer === '' ||
    clientId === undefined ||
    clientId === '' ||
    clientSecret === undefined ||
    clientSecret === '' ||
    redirectUri === undefined ||
    redirectUri === ''
  ) {
    return undefined;
  }
  const label = env.AUTH_OIDC_LABEL?.trim();
  const scopes = env.AUTH_OIDC_SCOPES?.trim();
  return {
    issuer: issuer.replace(/\/$/u, ''),
    clientId,
    clientSecret,
    redirectUri,
    ...(label === undefined || label === '' ? {} : { label }),
    ...(scopes === undefined || scopes === '' ? {} : { scopes }),
  };
}

export interface OidcIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly email: string | undefined;
  readonly emailVerified: boolean;
  readonly name: string | undefined;
}

interface Discovery {
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
  readonly issuer: string;
}

export interface Oidc {
  configured(): boolean;
  label(): string;
  /** Where to send the browser, with the handshake recorded (20E.3). */
  begin(redirectTo: string): Promise<{ readonly url: string; readonly state: string }>;
  /** What came back: verified, and turned into an identity (20E.4). */
  complete(
    state: string,
    code: string,
  ): Promise<{ readonly identity: OidcIdentity; readonly redirectTo: string }>;
}

export interface OidcOptions {
  readonly config: OidcConfig;
  readonly store: AuthStore;
  readonly fetch?: typeof fetch;
  readonly clock?: () => Date;
  readonly random?: (size: number) => Buffer;
  /** How long a handshake may take. Default five minutes. */
  readonly flowMs?: number;
  /** How long discovery and the keys are kept. Default ten minutes. */
  readonly cacheMs?: number;
}

async function readJson(response: Response, what: string): Promise<unknown> {
  if (!response.ok) {
    throw new OidcError('AUTH_OIDC_PROVIDER', `the identity provider refused to give ${what}`, {
      details: { status: response.status, what },
    });
  }
  try {
    return await response.json();
  } catch (error) {
    throw new OidcError('AUTH_OIDC_PROVIDER', `${what} came back as something other than JSON`, {
      cause: error,
    });
  }
}

export function createOidc(options: OidcOptions): Oidc {
  const { config, store } = options;
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const clock = options.clock ?? ((): Date => new Date());
  const random = options.random ?? randomBytes;
  const flowMs = options.flowMs ?? 5 * 60 * 1000;
  const cacheMs = options.cacheMs ?? 10 * 60 * 1000;

  let discovered: { readonly at: number; readonly value: Discovery } | undefined;
  let keys: { readonly at: number; readonly value: readonly Jwk[] } | undefined;

  const discover = async (): Promise<Discovery> => {
    const now = clock().getTime();
    if (discovered !== undefined && now - discovered.at < cacheMs) {
      return discovered.value;
    }
    const response = await doFetch(`${config.issuer}/.well-known/openid-configuration`);
    const value = (await readJson(response, 'its configuration')) as Discovery;
    if (
      typeof value.authorization_endpoint !== 'string' ||
      typeof value.token_endpoint !== 'string' ||
      typeof value.jwks_uri !== 'string'
    ) {
      throw new OidcError('AUTH_OIDC_PROVIDER', 'the issuer published an unusable configuration');
    }
    discovered = { at: now, value };
    return value;
  };

  const jwks = async (): Promise<readonly Jwk[]> => {
    const now = clock().getTime();
    if (keys !== undefined && now - keys.at < cacheMs) {
      return keys.value;
    }
    const { jwks_uri: uri } = await discover();
    const body = (await readJson(await doFetch(uri), 'its keys')) as { keys?: readonly Jwk[] };
    const value = body.keys ?? [];
    keys = { at: now, value };
    return value;
  };

  return {
    configured: () => true,
    label: () => config.label ?? `Sign in with ${new URL(config.issuer).host}`,

    async begin(redirectTo) {
      const now = clock();
      store.flows.removeExpired(now.toISOString());
      const { verifier, challenge } = pkce(random);
      const state = random(32).toString('base64url');
      const nonce = random(32).toString('base64url');
      store.flows.create({
        state,
        codeVerifier: verifier,
        nonce,
        redirectTo,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + flowMs).toISOString(),
      });
      const { authorization_endpoint: endpoint } = await discover();
      const url = new URL(endpoint);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', config.clientId);
      url.searchParams.set('redirect_uri', config.redirectUri);
      url.searchParams.set('scope', config.scopes ?? 'openid email profile');
      url.searchParams.set('state', state);
      url.searchParams.set('nonce', nonce);
      url.searchParams.set('code_challenge', challenge);
      url.searchParams.set('code_challenge_method', 'S256');
      return { url: url.toString(), state };
    },

    async complete(state, code) {
      const now = clock();
      const flow = store.flows.take(state);
      if (flow === undefined) {
        throw new OidcError('AUTH_OIDC_STATE', 'this sign-in was not started here, or is finished');
      }
      if (Date.parse(flow.expiresAt) <= now.getTime()) {
        throw new OidcError('AUTH_OIDC_STATE', 'this sign-in took too long; start it again');
      }
      const { token_endpoint: endpoint } = await discover();
      const response = await doFetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: config.redirectUri,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code_verifier: flow.codeVerifier,
        }).toString(),
      });
      const tokens = (await readJson(response, 'a token')) as { id_token?: string };
      if (typeof tokens.id_token !== 'string') {
        throw new OidcError('AUTH_OIDC_PROVIDER', 'the identity provider sent no ID token');
      }
      const claims = verifyIdToken(tokens.id_token, {
        issuer: config.issuer,
        audience: config.clientId,
        nonce: flow.nonce,
        keys: await jwks(),
        now,
      });
      return {
        identity: {
          issuer: claims.iss,
          subject: claims.sub,
          email: typeof claims.email === 'string' ? claims.email.toLowerCase() : undefined,
          emailVerified: claims.email_verified === true,
          name: typeof claims.name === 'string' ? claims.name : undefined,
        },
        redirectTo: flow.redirectTo,
      };
    },
  };
}
