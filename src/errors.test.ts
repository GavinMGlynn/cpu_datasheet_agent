import { describe, expect, it } from 'vitest';

import { ChipAgentError, isChipAgentError } from './errors.js';

class SampleError extends ChipAgentError {}

describe('ChipAgentError', () => {
  it('carries code, message, and an empty frozen details object by default', () => {
    const error = new ChipAgentError('SAMPLE_CODE', 'something happened');

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('SAMPLE_CODE');
    expect(error.message).toBe('something happened');
    expect(error.details).toEqual({});
    expect(Object.isFrozen(error.details)).toBe(true);
    expect(error.cause).toBeUndefined();
  });

  it('uses the concrete class name as the error name', () => {
    expect(new ChipAgentError('A', 'a').name).toBe('ChipAgentError');
    expect(new SampleError('B', 'b').name).toBe('SampleError');
  });

  it('copies and freezes details so later mutation of the source has no effect', () => {
    const source: Record<string, unknown> = { path: 'x' };
    const error = new ChipAgentError('A', 'a', { details: source });
    source.path = 'changed';

    expect(error.details).toEqual({ path: 'x' });
    expect(Object.isFrozen(error.details)).toBe(true);
  });

  it('attaches a cause when one is given', () => {
    const cause = new Error('root');
    const error = new ChipAgentError('A', 'a', { cause });

    expect(error.cause).toBe(cause);
  });

  it('keeps a null cause as null rather than dropping it', () => {
    const error = new ChipAgentError('A', 'a', { cause: null });

    expect(error.cause).toBeNull();
    expect(error.toJSON()).toEqual({
      name: 'ChipAgentError',
      code: 'A',
      message: 'a',
      details: {},
      cause: null,
    });
  });

  describe('toJSON', () => {
    it('omits the cause key when there is no cause', () => {
      const json = new ChipAgentError('A', 'a', { details: { n: 1 } }).toJSON();

      expect(json).toEqual({ name: 'ChipAgentError', code: 'A', message: 'a', details: { n: 1 } });
      expect('cause' in json).toBe(false);
    });

    it('serialises a ChipAgentError cause recursively', () => {
      const inner = new SampleError('INNER', 'inner', { details: { k: 'v' } });
      const outer = new ChipAgentError('OUTER', 'outer', { cause: inner });

      expect(outer.toJSON()).toEqual({
        name: 'ChipAgentError',
        code: 'OUTER',
        message: 'outer',
        details: {},
        cause: { name: 'SampleError', code: 'INNER', message: 'inner', details: { k: 'v' } },
      });
    });

    it('reduces a plain Error cause to its name and message', () => {
      const outer = new ChipAgentError('OUTER', 'outer', { cause: new TypeError('bad type') });

      expect(outer.toJSON().cause).toEqual({ name: 'TypeError', message: 'bad type' });
    });

    it('passes a non-error cause through unchanged', () => {
      const outer = new ChipAgentError('OUTER', 'outer', { cause: { status: 500 } });

      expect(outer.toJSON().cause).toEqual({ status: 500 });
    });

    it('never includes a stack, so JSON.stringify output is compact and stable', () => {
      const text = JSON.stringify(new ChipAgentError('A', 'a', { cause: new Error('x') }));

      expect(text).toBe(
        '{"name":"ChipAgentError","code":"A","message":"a","details":{},"cause":{"name":"Error","message":"x"}}',
      );
    });
  });
});

describe('isChipAgentError', () => {
  it('accepts instances and subclasses', () => {
    expect(isChipAgentError(new ChipAgentError('A', 'a'))).toBe(true);
    expect(isChipAgentError(new SampleError('A', 'a'))).toBe(true);
  });

  it('rejects other errors and non-errors', () => {
    expect(isChipAgentError(new Error('a'))).toBe(false);
    expect(isChipAgentError({ code: 'A', message: 'a' })).toBe(false);
    expect(isChipAgentError(null)).toBe(false);
    expect(isChipAgentError(undefined)).toBe(false);
  });
});
