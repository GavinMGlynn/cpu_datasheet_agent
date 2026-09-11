import { describe, expect, it } from 'vitest';

import { MissingValueError, required } from './present.js';

describe('required', () => {
  it('returns a value that is there, including falsy ones', () => {
    expect(required('a quote', 'the quote')).toBe('a quote');
    expect(required(0, 'the count')).toBe(0);
    expect(required(null, 'the reading')).toBeNull();
  });

  it('names what was missing rather than substituting for it', () => {
    expect(() => {
      required(undefined, 'the quote on a contradicted verdict');
    }).toThrow(MissingValueError);
    try {
      required(undefined, 'the quote on a contradicted verdict');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'VALUE_MISSING',
        details: { what: 'the quote on a contradicted verdict' },
      });
    }
  });
});
