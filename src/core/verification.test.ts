import { describe, it } from 'vitest';

import { verification } from '../../test/helpers/core-fixtures.js';
import { expectAccepts, expectRejects } from '../../test/helpers/schema.js';
import { VERDICTS, Verdict, Verification } from './verification.js';

describe('Verdict', () => {
  it.each(VERDICTS)('accepts %s', (value) => {
    expectAccepts(Verdict, value);
  });

  it('rejects unknown verdicts', () => {
    expectRejects(Verdict, 'unsure');
  });
});

describe('Verification', () => {
  it('accepts confirmed and contradicted verdicts with a quote', () => {
    expectAccepts(Verification, verification());
    expectAccepts(
      Verification,
      verification({ verdict: 'contradicted', quote: 'Input voltage 3.5 V to 30 V' }),
    );
  });

  it('accepts not_found without a quote', () => {
    const { quote: _quote, ...rest } = verification({ verdict: 'not_found' });
    expectAccepts(Verification, rest);
  });

  it('rejects confirmed or contradicted without a quote', () => {
    const { quote: _quote, ...rest } = verification();
    expectRejects(Verification, rest, 'quote');
    expectRejects(Verification, { ...rest, verdict: 'contradicted' }, 'quote');
  });

  it('rejects not_found with a quote', () => {
    expectRejects(Verification, verification({ verdict: 'not_found' }), 'quote');
  });

  it.each([
    ['an unknown parameter key', verification({ parameterKey: 'vin' })],
    ['page 0', verification({ page: 0 })],
    ['a prompt version without a number', verification({ promptVersion: 'verify' })],
    ['a prompt version with uppercase', verification({ promptVersion: 'Verify.v1' })],
    ['an empty model', verification({ model: '' })],
    ['an empty quote', verification({ quote: '' })],
    ['an extra key', verification({ confidence: 1 })],
  ])('rejects %s', (_label, value) => {
    expectRejects(Verification, value);
  });
});
