import { describe, expect, it } from 'vitest';

import { ArrayIndexError, elementAt } from './array.js';

describe('elementAt', () => {
  it('returns the element at an index that exists', () => {
    expect(elementAt([1, 2, 3], 0)).toBe(1);
    expect(elementAt([1, 2, 3], 2)).toBe(3);
    expect(elementAt(['a'], 0)).toBe('a');
  });

  it('throws for an index past the end, an empty array, or a negative index', () => {
    expect(() => elementAt([1], 1)).toThrow(ArrayIndexError);
    expect(() => elementAt([], 0)).toThrow(ArrayIndexError);
    expect(() => elementAt([1], -1)).toThrow(ArrayIndexError);
  });

  it('reports the index and length', () => {
    try {
      elementAt([1, 2], 5);
    } catch (error) {
      expect((error as ArrayIndexError).code).toBe('ARRAY_INDEX_OUT_OF_RANGE');
      expect((error as ArrayIndexError).details).toEqual({ index: 5, length: 2 });
    }
  });

  it('throws when the stored element is itself undefined', () => {
    expect(() => {
      elementAt([undefined], 0);
    }).toThrow(ArrayIndexError);
  });
});
