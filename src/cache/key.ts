import { createHash } from 'node:crypto';

import { z } from 'zod';

import { ChipAgentError } from '../errors.js';

export class CacheError extends ChipAgentError {}

export const NAMESPACE_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

/** Identifies one cacheable request: a namespace (which adapter or operation) and its JSON parameters. */
export interface CacheKey {
  readonly namespace: string;
  readonly params: unknown;
}

/** Storage address derived from a {@link CacheKey}. */
export interface CacheRef {
  readonly namespace: string;
  /** Hex SHA-256 of the canonical key. */
  readonly hash: string;
}

const Json = z.json();

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
      );
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Serialises JSON deterministically: object keys sorted at every level, no
 * whitespace, numbers in their shortest form. Throws `CacheError`
 * (`CACHE_PARAMS_NOT_JSON`) for anything that is not plain JSON.
 */
export function canonicalJson(value: unknown): string {
  const result = Json.safeParse(value);
  if (!result.success) {
    throw new CacheError('CACHE_PARAMS_NOT_JSON', 'cache key params must be plain JSON', {
      details: { issues: result.error.issues.map((issue) => issue.message) },
    });
  }
  return stableStringify(result.data);
}

export function assertNamespace(namespace: string): void {
  if (!NAMESPACE_PATTERN.test(namespace)) {
    throw new CacheError('CACHE_INVALID_NAMESPACE', `invalid cache namespace "${namespace}"`, {
      details: { namespace },
    });
  }
}

/** Hex SHA-256 over the namespace and the canonical params. Different namespaces never collide. */
export function hashCacheKey(key: CacheKey): string {
  assertNamespace(key.namespace);
  return createHash('sha256')
    .update(key.namespace)
    .update('\n')
    .update(canonicalJson(key.params))
    .digest('hex');
}

export function refOf(key: CacheKey): CacheRef {
  return { namespace: key.namespace, hash: hashCacheKey(key) };
}
