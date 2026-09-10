import { describe, expect, it } from 'vitest';

import { loadConfig } from '../config.js';
import { ChipAgentError } from '../errors.js';
import {
  DEFAULT_KEY_PATTERNS,
  DEFAULT_REPLACEMENT,
  DEFAULT_SECRET_PATTERNS,
  MIN_SECRET_LENGTH,
  createRedactor,
  redact,
  secretsFromConfig,
} from './redact.js';

const SECRET = 'supersecretvalue123';

describe('redact', () => {
  it('replaces known secret values wherever they appear in strings', () => {
    expect(redact(`key=${SECRET}&x=1`, { secrets: [SECRET] })).toBe(
      `key=${DEFAULT_REPLACEMENT}&x=1`,
    );
    expect(redact({ nested: [`a ${SECRET} b ${SECRET}`] }, { secrets: [SECRET] })).toEqual({
      nested: [`a ${DEFAULT_REPLACEMENT} b ${DEFAULT_REPLACEMENT}`],
    });
  });

  it('ignores secrets shorter than the minimum length by value', () => {
    expect(MIN_SECRET_LENGTH).toBe(6);
    expect(redact('abcabc', { secrets: ['abc'] })).toBe('abcabc');
    expect(redact('abcdefabcdef', { secrets: ['abcdef'] })).toBe(
      `${DEFAULT_REPLACEMENT}${DEFAULT_REPLACEMENT}`,
    );
  });

  it('replaces secret-shaped patterns by default', () => {
    expect(redact('Authorization: Bearer abc.def-ghi')).toBe(
      `Authorization: ${DEFAULT_REPLACEMENT}`,
    );
    expect(redact('key sk-ant-api03-abc_def here')).toBe(`key ${DEFAULT_REPLACEMENT} here`);
    expect(redact('token ghp_abcdefghijklmnopqrstuvwxyz1234')).toBe(`token ${DEFAULT_REPLACEMENT}`);
    expect(DEFAULT_SECRET_PATTERNS.every((pattern) => pattern.global)).toBe(true);
  });

  it('accepts custom patterns, key patterns, and replacement text', () => {
    expect(redact('id=1234', { patterns: [/\d+/g], replacement: '#' })).toBe('id=#');
    expect(redact({ colour: 'red', size: 'M' }, { keyPatterns: [/colour/] })).toEqual({
      colour: DEFAULT_REPLACEMENT,
      size: 'M',
    });
  });

  it('replaces string values under secret-looking keys wholesale', () => {
    const input = {
      apiKey: 'plain',
      API_KEY: 'plain',
      clientSecret: 'plain',
      access_token: 'plain',
      password: 'plain',
      Authorization: 'plain',
      clientId: 'plain',
      username: 'gavin',
    };
    expect(redact(input)).toEqual({
      apiKey: DEFAULT_REPLACEMENT,
      API_KEY: DEFAULT_REPLACEMENT,
      clientSecret: DEFAULT_REPLACEMENT,
      access_token: DEFAULT_REPLACEMENT,
      password: DEFAULT_REPLACEMENT,
      Authorization: DEFAULT_REPLACEMENT,
      clientId: DEFAULT_REPLACEMENT,
      username: 'gavin',
    });
    expect(DEFAULT_KEY_PATTERNS.length).toBeGreaterThan(0);
  });

  it('walks non-string values under secret-looking keys instead of replacing them', () => {
    expect(redact({ token: { value: `x ${SECRET}`, ttl: 60 } }, { secrets: [SECRET] })).toEqual({
      token: { value: `x ${DEFAULT_REPLACEMENT}`, ttl: 60 },
    });
  });

  it('passes numbers, booleans, null, and undefined through', () => {
    expect(redact(5)).toBe(5);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });

  it('converts bigints, dates, and errors to JSON-safe forms', () => {
    expect(redact(10n)).toBe('10');
    expect(redact(new Date('2026-09-10T00:00:00Z'))).toBe('2026-09-10T00:00:00.000Z');
    expect(redact(new TypeError('bad'))).toEqual({
      name: 'TypeError',
      message: 'bad',
      details: {},
    });
    expect(
      redact(new ChipAgentError('X', `failed with ${SECRET}`, { details: { token: 'abc' } }), {
        secrets: [SECRET],
      }),
    ).toEqual({
      name: 'ChipAgentError',
      code: 'X',
      message: `failed with ${DEFAULT_REPLACEMENT}`,
      details: { token: DEFAULT_REPLACEMENT },
    });
  });

  it('drops functions and symbols from objects and nulls them in arrays', () => {
    const symbol = Symbol('s');
    expect(redact({ fn: () => 1, sym: symbol, keep: 1 })).toEqual({ keep: 1 });
    expect(redact([() => 1, symbol, 2])).toEqual([null, null, 2]);
  });

  it('marks cycles instead of recursing forever', () => {
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic.self = cyclic;
    expect(redact(cyclic)).toEqual({ name: 'root', self: '[circular]' });
  });

  it('does not treat repeated references to the same leaf object as cycles', () => {
    const shared = { v: 1 };
    expect(redact({ a: shared, b: shared })).toEqual({ a: { v: 1 }, b: '[circular]' });
  });
});

describe('createRedactor', () => {
  it('binds options once and starts a fresh cycle set per call', () => {
    const redactor = createRedactor({ secrets: [SECRET] });
    const shared = { note: SECRET };
    expect(redactor({ a: shared })).toEqual({ a: { note: DEFAULT_REPLACEMENT } });
    expect(redactor({ a: shared })).toEqual({ a: { note: DEFAULT_REPLACEMENT } });
  });
});

describe('secretsFromConfig', () => {
  it('collects credentials from both Digi-Key environments, not only the selected one', () => {
    const config = loadConfig(
      {
        DIGIKEY_CLIENT_ID: 'dk-id',
        DIGIKEY_SANDBOX_CLIENT_SECRET: 'dk-sandbox-secret',
        MOUSER_API_KEY: 'mouser-key',
        FARNELL_API_KEY: 'farnell-key',
        ANTHROPIC_API_KEY: 'sk-ant-x',
      },
      { cwd: '/work' },
    );
    expect(secretsFromConfig(config)).toEqual([
      'dk-id',
      'dk-sandbox-secret',
      'mouser-key',
      'farnell-key',
      'sk-ant-x',
    ]);
    expect(secretsFromConfig(loadConfig({}, { cwd: '/work' }))).toEqual([]);
  });
});
