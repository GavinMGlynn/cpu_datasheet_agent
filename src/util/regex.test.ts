import { describe, expect, it } from 'vitest';

import { RegexGroupError, group, optionalGroup } from './regex.js';

function match(pattern: RegExp, text: string): RegExpExecArray {
  const result = pattern.exec(text);
  if (result === null) {
    throw new Error('expected a match');
  }
  return result;
}

describe('group', () => {
  it('returns a participating group, including an empty one', () => {
    const m = match(/^([+-]?)(\d+)$/, '42');
    expect(group(m, 0)).toBe('42');
    expect(group(m, 1)).toBe('');
    expect(group(m, 2)).toBe('42');
  });

  it('throws when the group did not participate', () => {
    const m = match(/(a)|(b)/, 'a');
    expect(() => group(m, 2)).toThrow(RegexGroupError);
    try {
      group(m, 2);
    } catch (error) {
      expect((error as RegexGroupError).code).toBe('REGEX_GROUP_MISSING');
      expect((error as RegexGroupError).details).toEqual({ index: 2, matched: 'a' });
    }
  });

  it('throws when the index is out of range', () => {
    expect(() => group(match(/x/, 'x'), 9)).toThrow(RegexGroupError);
  });
});

describe('optionalGroup', () => {
  it('returns the text or undefined', () => {
    const m = match(/^(\d+)(?:\.(\d+))?$/, '5');
    expect(optionalGroup(m, 1)).toBe('5');
    expect(optionalGroup(m, 2)).toBeUndefined();
  });
});
