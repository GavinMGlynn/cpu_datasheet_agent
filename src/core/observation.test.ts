import { describe, it } from 'vitest';

import { CACHE_KEY, distributorProvenance, q } from '../../test/helpers/core-fixtures.js';
import { expectAccepts, expectRejects } from '../../test/helpers/schema.js';
import { ObservedValue, ParameterConflict } from './observation.js';

describe('ObservedValue', () => {
  it.each([
    ['a quantity', { kind: 'quantity', value: q(36, 'V') }],
    ['an upper bound', { kind: 'max', value: q(1000000, 'Hz') }],
    ['a lower bound', { kind: 'min', value: q(3, 'V') }],
    ['a range', { kind: 'range', value: { unit: 'Hz', min: 100000, max: 1500000 } }],
    ['an enum', { kind: 'enum', value: 'adjustable' }],
    ['a boolean', { kind: 'boolean', value: true }],
    ['text', { kind: 'text', value: '8-SOIC (0.154", 3.90mm Width)' }],
  ])('accepts %s', (_label, value) => {
    expectAccepts(ObservedValue, value);
  });

  it.each([
    ['an unknown kind', { kind: 'guess', value: 'yes' }],
    ['a missing kind', { value: q(36, 'V') }],
    [
      'a range where a quantity is expected',
      { kind: 'quantity', value: { unit: 'V', min: 1, max: 2 } },
    ],
    ['a quantity where a range is expected', { kind: 'range', value: q(36, 'V') }],
    ['a bare number', { kind: 'quantity', value: 36 }],
    ['a string where a boolean is expected', { kind: 'boolean', value: 'true' }],
    ['an empty enum', { kind: 'enum', value: '' }],
    ['empty text', { kind: 'text', value: '' }],
    ['an enum past 64 characters', { kind: 'enum', value: 'a'.repeat(65) }],
    ['text past 500 characters', { kind: 'text', value: 'a'.repeat(501) }],
    ['an extra key', { kind: 'quantity', value: q(36, 'V'), key: 'vinMax' }],
  ])('rejects %s', (_label, value) => {
    expectRejects(ObservedValue, value);
  });
});

describe('ParameterConflict', () => {
  const conflict = {
    observed: { kind: 'quantity', value: q(36, 'V') },
    provenance: distributorProvenance(),
    rule: 'quantity-tolerance.v1',
  };

  it('accepts an observed value with distributor provenance and a rule', () => {
    expectAccepts(ParameterConflict, conflict);
  });

  it.each([
    ['a missing rule', { observed: conflict.observed, provenance: distributorProvenance() }],
    ['an empty rule', { ...conflict, rule: '' }],
    ['a missing observation', { provenance: distributorProvenance(), rule: 'quantity.v1' }],
    ['a missing provenance', { observed: conflict.observed, rule: 'quantity.v1' }],
    [
      'a datasheet provenance',
      {
        ...conflict,
        provenance: { source: 'datasheet', sha256: CACHE_KEY, page: 3, method: 'text' },
      },
    ],
    ['an extra key', { ...conflict, note: 'rounded' }],
  ])('rejects %s', (_label, value) => {
    expectRejects(ParameterConflict, value);
  });
});
