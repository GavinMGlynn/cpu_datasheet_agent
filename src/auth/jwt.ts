import { createHash, createPublicKey, randomBytes, verify as verifySignature } from 'node:crypto';

import { ChipAgentError } from '../errors.js';
import { elementAt } from '../util/array.js';

/**
 * Just enough JWT to check an ID token, written against the specification
 * rather than taken from a package.
 *
 * A library would be four dependencies for three operations, and this is the
 * one place in the project where a supply-chain problem would be an
 * authentication bypass. RS256 and ES256 cover every issuer this is likely
 * to meet; anything else is refused rather than guessed at.
 */

export class JwtError extends ChipAgentError {}

export interface Jwk {
  readonly kty: string;
  readonly kid?: string;
  readonly alg?: string;
  readonly use?: string;
  readonly n?: string;
  readonly e?: string;
  readonly crv?: string;
  readonly x?: string;
  readonly y?: string;
}

export interface JwtHeader {
  readonly alg: string;
  readonly kid?: string;
  readonly typ?: string;
}

export interface IdTokenClaims {
  readonly iss: string;
  readonly sub: string;
  readonly aud: string | readonly string[];
  readonly exp: number;
  readonly iat: number;
  readonly nonce?: string;
  readonly email?: string;
  readonly email_verified?: boolean;
  readonly name?: string;
  readonly nbf?: number;
}

const ALGORITHMS: Readonly<Record<string, { readonly hash: string; readonly kty: string }>> =
  Object.freeze({
    RS256: { hash: 'sha256', kty: 'RSA' },
    ES256: { hash: 'sha256', kty: 'EC' },
  });

function decodePart(part: string, what: string): unknown {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch (error) {
    throw new JwtError('AUTH_TOKEN_UNREADABLE', `the ${what} of this token is not JSON`, {
      cause: error,
    });
  }
}

/** Splits a token into its three parts, without trusting any of them yet. */
export function readToken(token: string): {
  readonly header: JwtHeader;
  readonly claims: IdTokenClaims;
  readonly signed: string;
  readonly signature: Buffer;
} {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new JwtError('AUTH_TOKEN_UNREADABLE', 'an ID token has three parts');
  }
  const header = decodePart(elementAt(parts, 0), 'header') as JwtHeader;
  const claims = decodePart(elementAt(parts, 1), 'body') as IdTokenClaims;
  if (typeof header.alg !== 'string') {
    throw new JwtError('AUTH_TOKEN_UNREADABLE', 'this token names no algorithm');
  }
  return {
    header,
    claims,
    signed: `${elementAt(parts, 0)}.${elementAt(parts, 1)}`,
    signature: Buffer.from(elementAt(parts, 2), 'base64url'),
  };
}

export interface VerifyOptions {
  readonly issuer: string;
  readonly audience: string;
  readonly nonce: string;
  readonly keys: readonly Jwk[];
  readonly now: Date;
  /** How much clock difference to allow, in seconds. Default 60. */
  readonly skewSeconds?: number;
}

/**
 * Checks an ID token the way the specification says to: the signature
 * against the issuer's published key, then the issuer, the audience, the
 * expiry and the nonce. Every one of them is a refusal, not a warning.
 */
export function verifyIdToken(token: string, options: VerifyOptions): IdTokenClaims {
  const { header, claims, signed, signature } = readToken(token);
  const algorithm = ALGORITHMS[header.alg];
  if (algorithm === undefined) {
    throw new JwtError('AUTH_TOKEN_ALGORITHM', `this token is signed with ${header.alg}`, {
      details: { alg: header.alg },
    });
  }
  const candidates = options.keys.filter(
    (key) => key.kty === algorithm.kty && (header.kid === undefined || key.kid === header.kid),
  );
  if (candidates.length === 0) {
    throw new JwtError('AUTH_TOKEN_KEY_UNKNOWN', 'the issuer published no key for this token', {
      details: { kid: header.kid ?? 'none' },
    });
  }
  const verified = candidates.some((jwk) => {
    const key = createPublicKey({ key: jwk as unknown as Record<string, unknown>, format: 'jwk' });
    return verifySignature(
      algorithm.hash,
      Buffer.from(signed),
      header.alg === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' } : key,
      signature,
    );
  });
  if (!verified) {
    throw new JwtError('AUTH_TOKEN_SIGNATURE', 'this token is not signed by the issuer');
  }
  if (claims.iss !== options.issuer) {
    throw new JwtError('AUTH_TOKEN_ISSUER', 'this token came from somewhere else', {
      details: { issuer: claims.iss },
    });
  }
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.includes(options.audience)) {
    throw new JwtError('AUTH_TOKEN_AUDIENCE', 'this token was issued for something else');
  }
  const skew = options.skewSeconds ?? 60;
  const seconds = Math.floor(options.now.getTime() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + skew < seconds) {
    throw new JwtError('AUTH_TOKEN_EXPIRED', 'this token has expired');
  }
  if (typeof claims.nbf === 'number' && claims.nbf - skew > seconds) {
    throw new JwtError('AUTH_TOKEN_EXPIRED', 'this token is not valid yet');
  }
  if (claims.nonce !== options.nonce) {
    throw new JwtError('AUTH_TOKEN_NONCE', 'this token answers a different sign-in');
  }
  if (typeof claims.sub !== 'string' || claims.sub === '') {
    throw new JwtError('AUTH_TOKEN_UNREADABLE', 'this token names no subject');
  }
  return claims;
}

/** A PKCE pair: what is kept, and what is sent (RFC 7636, S256). */
export function pkce(random: (size: number) => Buffer = randomBytes): {
  readonly verifier: string;
  readonly challenge: string;
} {
  const verifier = random(32).toString('base64url');
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  };
}
