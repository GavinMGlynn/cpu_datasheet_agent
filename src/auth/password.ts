import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { ChipAgentError } from '../errors.js';
import { elementAt } from '../util/array.js';

/**
 * Passwords, hashed with scrypt from the standard library.
 *
 * No dependency: `node:crypto` has scrypt, and a password hash is exactly
 * the kind of thing not to take from a package that can be replaced under
 * you. The parameters travel with the hash, so they can be raised later
 * without invalidating what is already stored — a sign-in with a weaker hash
 * re-hashes it (20B.2).
 *
 * The encoding is `scrypt$N$r$p$salt$hash`, both parts base64url.
 */

export class PasswordError extends ChipAgentError {}

export interface ScryptParameters {
  /** Cost. Memory is 128 · N · r bytes, so 2^15 with r=8 is 32 MiB. */
  readonly cost: number;
  readonly blockSize: number;
  readonly parallelism: number;
  readonly keyLength: number;
  readonly saltLength: number;
}

export const CURRENT: ScryptParameters = Object.freeze({
  cost: 32_768,
  blockSize: 8,
  parallelism: 1,
  keyLength: 32,
  saltLength: 16,
});

/**
 * The shortest password this will store.
 *
 * Length and nothing else: composition rules push people towards
 * `Password1!` and a rule nobody can satisfy is a rule written down beside
 * the screen (20B.3).
 */
export const MINIMUM_LENGTH = 12;
export const MAXIMUM_LENGTH = 200;

const derive = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

function maxmem(parameters: ScryptParameters): number {
  // Node refuses when 128 · N · r is above maxmem, which defaults to 32 MiB —
  // exactly what the current parameters need, so it is raised deliberately.
  return 256 * parameters.cost * parameters.blockSize;
}

function encode(value: Buffer): string {
  return value.toString('base64url');
}

/** Rejects a password nobody should be storing, with the reason. */
export function checkPassword(password: string): void {
  if (password.length < MINIMUM_LENGTH) {
    throw new PasswordError(
      'AUTH_PASSWORD_TOO_SHORT',
      `a password must be at least ${String(MINIMUM_LENGTH)} characters`,
      { details: { minimum: MINIMUM_LENGTH } },
    );
  }
  if (password.length > MAXIMUM_LENGTH) {
    throw new PasswordError(
      'AUTH_PASSWORD_TOO_LONG',
      `a password must be at most ${String(MAXIMUM_LENGTH)} characters`,
      { details: { maximum: MAXIMUM_LENGTH } },
    );
  }
}

export interface HashOptions {
  readonly parameters?: ScryptParameters;
  readonly random?: (size: number) => Buffer;
}

/** Hashes a password, with the parameters recorded beside it. */
export async function hashPassword(password: string, options: HashOptions = {}): Promise<string> {
  checkPassword(password);
  const parameters = options.parameters ?? CURRENT;
  const salt = (options.random ?? randomBytes)(parameters.saltLength);
  const key = await derive(password.normalize('NFKC'), salt, parameters.keyLength, {
    N: parameters.cost,
    r: parameters.blockSize,
    p: parameters.parallelism,
    maxmem: maxmem(parameters),
  });
  return [
    'scrypt',
    String(parameters.cost),
    String(parameters.blockSize),
    String(parameters.parallelism),
    encode(salt),
    encode(key),
  ].join('$');
}

interface Parsed {
  readonly parameters: ScryptParameters;
  readonly salt: Buffer;
  readonly key: Buffer;
}

function parse(stored: string): Parsed {
  const parts = stored.split('$');
  if (parts.length !== 6 || elementAt(parts, 0) !== 'scrypt') {
    throw new PasswordError('AUTH_HASH_UNREADABLE', 'this is not a stored scrypt hash');
  }
  const numbers = [1, 2, 3].map((index) => Number(elementAt(parts, index)));
  if (!numbers.every((one) => Number.isInteger(one) && one > 0)) {
    throw new PasswordError('AUTH_HASH_UNREADABLE', 'the stored scrypt parameters are not numbers');
  }
  const costValue = elementAt(numbers, 0);
  const blockValue = elementAt(numbers, 1);
  const parallelValue = elementAt(numbers, 2);
  const saltBytes = Buffer.from(elementAt(parts, 4), 'base64url');
  const keyBytes = Buffer.from(elementAt(parts, 5), 'base64url');
  if (saltBytes.length === 0 || keyBytes.length === 0) {
    throw new PasswordError('AUTH_HASH_UNREADABLE', 'the stored salt or hash is empty');
  }
  return {
    parameters: {
      cost: costValue,
      blockSize: blockValue,
      parallelism: parallelValue,
      keyLength: keyBytes.length,
      saltLength: saltBytes.length,
    },
    salt: saltBytes,
    key: keyBytes,
  };
}

/**
 * Whether this password is the one that was hashed.
 *
 * Compared in constant time, and a hash this cannot read is a refusal rather
 * than an exception the caller might mistake for "no".
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const { parameters, salt, key } = parse(stored);
  const candidate = await derive(password.normalize('NFKC'), salt, parameters.keyLength, {
    N: parameters.cost,
    r: parameters.blockSize,
    p: parameters.parallelism,
    maxmem: maxmem(parameters),
  });
  return timingSafeEqual(candidate, key);
}

/** True when the stored hash is weaker than what this version would write. */
export function needsRehash(stored: string, parameters: ScryptParameters = CURRENT): boolean {
  const found = parse(stored).parameters;
  return (
    found.cost < parameters.cost ||
    found.blockSize < parameters.blockSize ||
    found.keyLength < parameters.keyLength ||
    found.saltLength < parameters.saltLength
  );
}
