import { createHash, createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';

/**
 * An OpenID Connect issuer, in a test.
 *
 * Real keys, real signatures, real discovery documents — everything except
 * the network, which is a `fetch` the test hands to the client. Verifying an
 * ID token is the security-critical part of single sign-on, and a fake that
 * signed nothing would prove nothing.
 */

export interface FakeIssuerOptions {
  readonly issuer?: string;
  readonly clientId?: string;
  readonly kid?: string;
}

export interface FakeIssuer {
  readonly issuer: string;
  readonly clientId: string;
  readonly fetch: typeof fetch;
  /** Requests the client made, in order. */
  readonly calls: { readonly url: string; readonly body?: string }[];
  /** What the token endpoint will answer with next. */
  tokenResponse: { status: number; body: unknown };
  /** Signs an ID token with the issuer's key. */
  sign(claims: Record<string, unknown>, options?: { readonly kid?: string }): string;
  /** Signs with a key the issuer has never published. */
  signWithStranger(claims: Record<string, unknown>): string;
  /** Replaces the published keys, for the "no key for this token" case. */
  publish(keys: readonly unknown[]): void;
}

function jwkOf(key: KeyObject, kid: string): Record<string, unknown> {
  return { ...key.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function fakeIssuer(options: FakeIssuerOptions = {}): FakeIssuer {
  const issuer = options.issuer ?? 'https://issuer.invalid';
  const clientId = options.clientId ?? 'a-client-id';
  const kid = options.kid ?? 'key-1';
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const calls: { url: string; body?: string }[] = [];
  let published: readonly unknown[] = [jwkOf(pair.publicKey, kid)];

  const sign = (claims: Record<string, unknown>, signOptions: { kid?: string } = {}): string => {
    const header = base64url({ alg: 'RS256', typ: 'JWT', kid: signOptions.kid ?? kid });
    const body = base64url(claims);
    const signature = createSign('sha256').update(`${header}.${body}`).sign(pair.privateKey);
    return `${header}.${body}.${signature.toString('base64url')}`;
  };

  const fetcher = ((url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ url, ...(body === undefined ? {} : { body }) });
    const answer = (status: number, body: unknown): Response =>
      ({
        ok: status < 400,
        status,
        json: () => Promise.resolve(body),
      }) as Response;
    if (url === `${issuer}/.well-known/openid-configuration`) {
      return Promise.resolve(
        answer(200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        }),
      );
    }
    if (url === `${issuer}/jwks`) {
      return Promise.resolve(answer(200, { keys: published }));
    }
    if (url === `${issuer}/token`) {
      return Promise.resolve(answer(result.tokenResponse.status, result.tokenResponse.body));
    }
    return Promise.resolve(answer(404, { error: 'not_found' }));
  }) as unknown as typeof fetch;

  const result: FakeIssuer = {
    issuer,
    clientId,
    fetch: fetcher,
    calls,
    tokenResponse: { status: 200, body: {} },
    sign,
    signWithStranger(claims) {
      const header = base64url({ alg: 'RS256', typ: 'JWT', kid });
      const body = base64url(claims);
      const signature = createSign('sha256').update(`${header}.${body}`).sign(stranger.privateKey);
      return `${header}.${body}.${signature.toString('base64url')}`;
    },
    publish(keys) {
      published = keys;
    },
  };
  return result;
}

/** The claims a well-behaved issuer would send, for a test to bend. */
export function idClaims(
  issuer: FakeIssuer,
  nonce: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const seconds = Math.floor(Date.parse('2026-09-12T09:00:00.000Z') / 1000);
  return {
    iss: issuer.issuer,
    sub: 'subject-1',
    aud: issuer.clientId,
    iat: seconds,
    exp: seconds + 3600,
    nonce,
    email: 'gavin@example.com',
    email_verified: true,
    name: 'Gavin',
    ...overrides,
  };
}

/** The PKCE challenge for a verifier, so a test can check what was sent. */
export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
