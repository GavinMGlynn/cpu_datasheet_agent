import { describe, it } from 'vitest';

import { EARLIER, LATER, escalation } from '../../test/helpers/core-fixtures.js';
import { expectAccepts, expectRejects } from '../../test/helpers/schema.js';
import { ESCALATION_KINDS, Escalation, EscalationKind } from './escalation.js';

describe('EscalationKind', () => {
  it.each(ESCALATION_KINDS)('accepts %s', (value) => {
    expectAccepts(EscalationKind, value);
  });

  it('rejects unknown kinds', () => {
    expectRejects(EscalationKind, 'question');
  });
});

describe('Escalation', () => {
  it('accepts an open escalation with and without options', () => {
    expectAccepts(Escalation, escalation());
    expectAccepts(Escalation, escalation({ options: ['28 V', '30 V'] }));
  });

  it('accepts a resolved escalation', () => {
    expectAccepts(
      Escalation,
      escalation({
        resolution: { answer: '28 V per datasheet page 4', resolvedAt: LATER, by: 'gavin' },
      }),
    );
    expectAccepts(
      Escalation,
      escalation({
        resolution: { answer: 'same instant', resolvedAt: escalation().createdAt, by: 'gavin' },
      }),
    );
  });

  it('accepts nested JSON context', () => {
    expectAccepts(
      Escalation,
      escalation({
        context: {
          candidates: [
            { mpn: 'A', score: 0.5 },
            { mpn: 'B', score: null },
          ],
          flags: { x: true },
        },
      }),
    );
  });

  it('rejects a resolution earlier than creation', () => {
    expectRejects(
      Escalation,
      escalation({ resolution: { answer: 'x', resolvedAt: EARLIER, by: 'gavin' } }),
      'resolution.resolvedAt',
    );
  });

  it.each([
    ['a non-UUID id', escalation({ id: 'esc-1' })],
    ['a non-normalised mpn', escalation({ mpn: 'tps54331dr' })],
    ['an empty question', escalation({ question: '' })],
    ['a single option', escalation({ options: ['only'] })],
    ['an empty option', escalation({ options: ['a', ' '] })],
    ['non-JSON context', escalation({ context: { big: 10n } })],
    ['a context that is not an object', escalation({ context: 'see above' })],
    [
      'a resolution missing who resolved it',
      escalation({ resolution: { answer: 'x', resolvedAt: LATER } }),
    ],
    ['an extra key', escalation({ priority: 'high' })],
  ])('rejects %s', (_label, value) => {
    expectRejects(Escalation, value);
  });
});
