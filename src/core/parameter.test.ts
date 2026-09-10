import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  datasheetProvenance,
  derivedProvenance,
  distributorProvenance,
  humanProvenance,
} from '../../test/helpers/core-fixtures.js';
import { expectAccepts, expectRejects } from '../../test/helpers/schema.js';
import { CONFIDENCES, Confidence, parameter } from './parameter.js';
import { quantityOf } from './quantity.js';

describe('Confidence', () => {
  it.each(CONFIDENCES)('accepts %s', (value) => {
    expectAccepts(Confidence, value);
  });

  it.each(['guessed', 'Verified', '', null])('rejects %j', (value) => {
    expectRejects(Confidence, value);
  });
});

describe('parameter', () => {
  const volts = parameter(quantityOf('V'));

  it('accepts a value with provenance of any kind and a confidence', () => {
    for (const provenance of [
      datasheetProvenance(),
      distributorProvenance(),
      humanProvenance(),
      derivedProvenance(),
    ]) {
      expectAccepts(volts, { value: { value: 5, unit: 'V' }, provenance, confidence: 'extracted' });
    }
  });

  it('accepts nullable value schemas', () => {
    const maybeVolts = parameter(quantityOf('V').nullable());
    expectAccepts(maybeVolts, {
      value: null,
      provenance: humanProvenance(),
      confidence: 'extracted',
    });
  });

  it.each([
    ['a missing provenance', { value: { value: 5, unit: 'V' }, confidence: 'extracted' }],
    ['a missing confidence', { value: { value: 5, unit: 'V' }, provenance: datasheetProvenance() }],
    ['a missing value', { provenance: datasheetProvenance(), confidence: 'extracted' }],
    ['a bare value', { value: 5, provenance: datasheetProvenance(), confidence: 'extracted' }],
    [
      'a wrong unit',
      {
        value: { value: 5, unit: 'A' },
        provenance: datasheetProvenance(),
        confidence: 'extracted',
      },
    ],
    [
      'an unknown confidence',
      { value: { value: 5, unit: 'V' }, provenance: datasheetProvenance(), confidence: 'sure' },
    ],
    [
      'an extra key',
      {
        value: { value: 5, unit: 'V' },
        provenance: datasheetProvenance(),
        confidence: 'extracted',
        page: 5,
      },
    ],
    [
      'a datasheet provenance without a page',
      {
        value: { value: 5, unit: 'V' },
        provenance: { source: 'datasheet', sha256: 'a'.repeat(64), method: 'text' },
        confidence: 'extracted',
      },
    ],
  ])('rejects %s', (_label, value) => {
    expectRejects(volts, value);
  });

  it('infers the wrapped value type', () => {
    const schema = parameter(z.boolean());
    const parsed = schema.parse({
      value: true,
      provenance: humanProvenance(),
      confidence: 'verified',
    });
    expect(parsed.value).toBe(true);
    expect(parsed.provenance.source).toBe('human');
  });
});
