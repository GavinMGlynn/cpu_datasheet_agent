import { describe, expect, it } from 'vitest';

import {
  CacheError,
  NAMESPACE_PATTERN,
  assertNamespace,
  canonicalJson,
  hashCacheKey,
  refOf,
} from './key.js';

describe('canonicalJson', () => {
  it('sorts object keys at every level and removes whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' } })).toBe(
      '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });

  it('keeps array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('serialises primitives like JSON', () => {
    expect(canonicalJson('s')).toBe('"s"');
    expect(canonicalJson(1.5)).toBe('1.5');
    expect(canonicalJson(-0)).toBe('0');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(null)).toBe('null');
  });

  it.each([
    ['undefined', undefined],
    ['a bigint', 10n],
    ['a function', () => 1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a nested non-JSON value', { ok: 1, bad: 1n }],
  ])('rejects %s', (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(CacheError);
    try {
      canonicalJson(value);
    } catch (error) {
      expect((error as CacheError).code).toBe('CACHE_PARAMS_NOT_JSON');
    }
  });
});

describe('assertNamespace', () => {
  it.each(['pdf', 'digikey-search', 'mouser_v1', 'a', `a${'b'.repeat(63)}`])(
    'accepts %s',
    (namespace) => {
      expect(() => {
        assertNamespace(namespace);
      }).not.toThrow();
      expect(NAMESPACE_PATTERN.test(namespace)).toBe(true);
    },
  );

  it.each(['', 'Pdf', '1pdf', 'pdf/x', 'pdf x', '-pdf', `a${'b'.repeat(64)}`])(
    'rejects %j',
    (namespace) => {
      expect(() => {
        assertNamespace(namespace);
      }).toThrow(CacheError);
    },
  );
});

describe('hashCacheKey', () => {
  it('is a hex SHA-256 independent of key order', () => {
    const a = hashCacheKey({ namespace: 'n', params: { x: 1, y: [1, { p: 1, q: 2 }] } });
    const b = hashCacheKey({ namespace: 'n', params: { y: [1, { q: 2, p: 1 }], x: 1 } });
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).toBe(b);
  });

  it('changes with any parameter change', () => {
    const base = hashCacheKey({ namespace: 'n', params: { x: 1 } });
    expect(hashCacheKey({ namespace: 'n', params: { x: 2 } })).not.toBe(base);
    expect(hashCacheKey({ namespace: 'n', params: { x: '1' } })).not.toBe(base);
    expect(hashCacheKey({ namespace: 'n', params: [1] })).not.toBe(base);
  });

  it('never collides across namespaces for the same params', () => {
    expect(hashCacheKey({ namespace: 'a', params: null })).not.toBe(
      hashCacheKey({ namespace: 'b', params: null }),
    );
    expect(hashCacheKey({ namespace: 'ab', params: 'c' })).not.toBe(
      hashCacheKey({ namespace: 'a', params: 'bc' }),
    );
  });

  it('is stable across runs (pinned digest)', () => {
    expect(hashCacheKey({ namespace: 'pdf', params: { url: 'https://x/y.pdf' } })).toBe(
      'cfa640d73198aa43994c9ec50b237bca98b6feca55b73f99da4f7908eb7e5c34',
    );
  });

  it('rejects an invalid namespace or non-JSON params', () => {
    expect(() => hashCacheKey({ namespace: 'Bad', params: 1 })).toThrow(CacheError);
    expect(() => hashCacheKey({ namespace: 'ok', params: undefined })).toThrow(CacheError);
  });
});

describe('refOf', () => {
  it('pairs the namespace with the hash', () => {
    const key = { namespace: 'pdf', params: { u: 1 } };
    expect(refOf(key)).toEqual({ namespace: 'pdf', hash: hashCacheKey(key) });
  });
});
