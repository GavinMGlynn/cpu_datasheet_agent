import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { isChipAgentError } from '../errors.js';
import { ValidationError, fromZodError, parseOrThrow } from './validation-error.js';

const schema = z.strictObject({
  name: z.string().min(1),
  nested: z.strictObject({ count: z.number().int() }),
});

function failing(value: unknown): ValidationError {
  try {
    parseOrThrow(schema, value, 'Sample');
  } catch (error) {
    if (error instanceof ValidationError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected parseOrThrow to throw');
}

describe('parseOrThrow', () => {
  it('returns the parsed value unchanged on success', () => {
    const value = { name: 'x', nested: { count: 2 } };
    expect(parseOrThrow(schema, value, 'Sample')).toEqual(value);
  });

  it('throws a ValidationError listing every issue with path, message, and received value', () => {
    const error = failing({ name: '', nested: { count: 1.5 }, extra: true });

    expect(error).toBeInstanceOf(ValidationError);
    expect(isChipAgentError(error)).toBe(true);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.subject).toBe('Sample');
    expect(error.issues.map((issue) => issue.path)).toEqual(['name', 'nested.count', '(root)']);
    expect(error.issues[0]?.received).toBe('');
    expect(error.issues[1]?.received).toBe(1.5);
    expect(error.issues[2]?.received).toEqual({ name: '', nested: { count: 1.5 }, extra: true });
    expect(error.message).toContain('Sample is invalid:\n  name: ');
    expect(error.details).toEqual({ subject: 'Sample', issues: error.issues });
  });

  it('reports the root path when the whole value has the wrong type', () => {
    const error = failing('not an object');

    expect(error.issues).toHaveLength(1);
    expect(error.issues[0]?.path).toBe('(root)');
    expect(error.issues[0]?.received).toBe('not an object');
  });

  it('never coerces: a numeric string is rejected where a number is expected', () => {
    const error = failing({ name: 'x', nested: { count: '2' } });

    expect(error.issues.map((issue) => issue.path)).toEqual(['nested.count']);
    expect(error.issues[0]?.received).toBe('2');
  });
});

describe('fromZodError', () => {
  it('leaves received undefined when the path runs through a non-object', () => {
    const result = schema.safeParse({ name: 'x', nested: { count: 'bad' } });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    const throughPrimitive = fromZodError('S', result.error, { name: 'x', nested: 5 });
    expect(throughPrimitive.issues[0]?.received).toBeUndefined();

    const throughNull = fromZodError('S', result.error, { name: 'x', nested: null });
    expect(throughNull.issues[0]?.received).toBeUndefined();
  });
});
