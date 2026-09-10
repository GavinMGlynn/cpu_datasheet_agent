import { describe, expect, it } from 'vitest';

import { deepFreeze } from './deep-freeze.js';

describe('deepFreeze', () => {
  it('returns primitives and null unchanged', () => {
    expect(deepFreeze(5)).toBe(5);
    expect(deepFreeze('s')).toBe('s');
    expect(deepFreeze(null)).toBeNull();
    expect(deepFreeze<unknown>(undefined)).toBeUndefined();
  });

  it('freezes the object itself and returns the same reference', () => {
    const input = { a: 1 };
    const output = deepFreeze(input);

    expect(output).toBe(input);
    expect(Object.isFrozen(output)).toBe(true);
  });

  it('freezes nested objects and arrays', () => {
    const input = { nested: { deeper: { value: 1 } }, list: [{ x: 1 }, [2, 3]] };
    deepFreeze(input);

    expect(Object.isFrozen(input.nested)).toBe(true);
    expect(Object.isFrozen(input.nested.deeper)).toBe(true);
    expect(Object.isFrozen(input.list)).toBe(true);
    expect(Object.isFrozen(input.list[0])).toBe(true);
    expect(Object.isFrozen(input.list[1])).toBe(true);
  });

  it('tolerates null and primitive children', () => {
    const input = { none: null, count: 2, name: 'n', missing: undefined };

    expect(() => deepFreeze(input)).not.toThrow();
    expect(Object.isFrozen(input)).toBe(true);
  });

  it('makes later writes throw in strict mode', () => {
    const frozen = deepFreeze({ inner: { value: 1 } });

    expect(() => {
      frozen.inner.value = 2;
    }).toThrow(TypeError);
  });
});
