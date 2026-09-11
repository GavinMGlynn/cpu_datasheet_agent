import { describe, expect, it } from 'vitest';

import {
  NOW,
  UUID,
  conflict,
  distributorProvenance,
  part as partFixture,
  verification,
  withConfidence,
} from '../../test/helpers/core-fixtures.js';
import {
  PARAMETER_KEYS,
  Part,
  Verification,
  parseOrThrow,
  type ParameterKey,
} from '../core/index.js';
import { applyVerdicts } from './verdicts.js';

const LATER = '2026-09-12T00:00:00Z';

const clock = {
  now: (): string => LATER,
  newId: (): string => UUID,
};

function part(overrides: Record<string, unknown> = {}): Part {
  return parseOrThrow(Part, partFixture(overrides), 'Part');
}

function verdict(overrides: Record<string, unknown> = {}): Verification {
  const built = verification(overrides);
  if (built.verdict === 'not_found') {
    delete built.quote;
  }
  return parseOrThrow(Verification, built, 'Verification');
}

/** A verdict for every parameter, as a run that checked everything leaves. */
function all(
  verdictFor: (key: ParameterKey) => Record<string, unknown>,
): Map<ParameterKey, Verification> {
  return new Map(
    PARAMETER_KEYS.map((key) => [key, verdict({ parameterKey: key, ...verdictFor(key) })]),
  );
}

describe('applyVerdicts', () => {
  it('marks a part verified when every value was confirmed on its page', () => {
    const outcome = applyVerdicts(
      part(),
      all(() => ({ verdict: 'confirmed' })),
      clock,
    );

    expect(outcome.part.status).toBe('verified');
    expect(outcome.confirmed).toHaveLength(PARAMETER_KEYS.length);
    expect(outcome.unchecked).toEqual([]);
    expect(outcome.escalations).toEqual([]);
    expect(outcome.changed).toBe(true);
    expect(
      PARAMETER_KEYS.every((key) => outcome.part.parameters[key].confidence === 'verified'),
    ).toBe(true);
    expect(outcome.part.updatedAt).toBe(LATER);
  });

  it('leaves a part alone when the verdicts change nothing', () => {
    const verified = part({
      parameters: withConfidence(partFixture().parameters as Record<string, unknown>, 'verified'),
      status: 'verified',
    });

    const outcome = applyVerdicts(
      verified,
      all(() => ({ verdict: 'confirmed' })),
      clock,
    );

    expect(outcome.changed).toBe(false);
    expect(outcome.part).toBe(verified);
  });

  it('turns a contradiction into a conflict, a question, and a part needing a person', () => {
    const outcome = applyVerdicts(
      part(),
      new Map([
        [
          'vinMax',
          verdict({ parameterKey: 'vinMax', verdict: 'contradicted', quote: 'VIN 3.5 V to 60 V' }),
        ],
      ]),
      clock,
    );

    expect(outcome.contradicted).toEqual(['vinMax']);
    expect(outcome.part.parameters.vinMax.confidence).toBe('conflict');
    expect(outcome.part.status).toBe('needs_human');
    expect(outcome.escalations).toHaveLength(1);
    expect(outcome.escalations[0]).toMatchObject({
      kind: 'conflict',
      mpn: 'TPS54331DR',
      context: { parameter: 'vinMax', page: 4, quote: 'VIN 3.5 V to 60 V' },
    });
    expect(outcome.escalations[0]?.question).toContain('Which is right?');
  });

  it('treats a safety rating nobody could find as a contradiction, and anything else as not found', () => {
    const outcome = applyVerdicts(
      part(),
      new Map([
        ['vinAbsMax', verdict({ parameterKey: 'vinAbsMax', verdict: 'not_found' })],
        ['softStart', verdict({ parameterKey: 'softStart', verdict: 'not_found' })],
      ]),
      clock,
    );

    expect(outcome.notFound).toEqual(['vinAbsMax', 'softStart']);
    expect(outcome.part.parameters.vinAbsMax.confidence).toBe('conflict');
    expect(outcome.part.parameters.softStart.confidence).toBe('extracted');
    expect(outcome.escalations).toHaveLength(1);
    expect(outcome.escalations[0]?.question).toContain('safety-relevant');
    expect(outcome.part.status).toBe('needs_human');
  });

  it('never promotes a value a distributor disagrees with, however the page reads', () => {
    const conflicted = part({
      parameters: {
        ...(partFixture().parameters as Record<string, unknown>),
        vinMax: {
          ...((partFixture().parameters as Record<string, Record<string, unknown>>).vinMax ?? {}),
          confidence: 'conflict',
          conflicts: [conflict()],
        },
      },
      status: 'needs_human',
    });

    const outcome = applyVerdicts(
      conflicted,
      all(() => ({ verdict: 'confirmed' })),
      clock,
    );

    expect(outcome.confirmed).toHaveLength(PARAMETER_KEYS.length);
    expect(outcome.part.parameters.vinMax.confidence).toBe('conflict');
    expect(outcome.part.status).toBe('needs_human');
  });

  it('leaves a value already in conflict where it is, and still asks', () => {
    const conflicted = part({
      parameters: {
        ...(partFixture().parameters as Record<string, unknown>),
        vinMax: {
          ...((partFixture().parameters as Record<string, Record<string, unknown>>).vinMax ?? {}),
          confidence: 'conflict',
          conflicts: [conflict()],
        },
      },
      status: 'needs_human',
    });

    const outcome = applyVerdicts(
      conflicted,
      new Map([
        [
          'vinMax',
          verdict({ parameterKey: 'vinMax', verdict: 'contradicted', quote: 'VIN 3.5 V to 60 V' }),
        ],
      ]),
      clock,
    );

    expect(outcome.contradicted).toEqual(['vinMax']);
    expect(outcome.escalations).toHaveLength(1);
    expect(outcome.changed).toBe(false);
    expect(outcome.part).toBe(conflicted);
  });

  it('counts a value from anywhere but the datasheet as unchecked', () => {
    const fromDistributor = part({
      parameters: {
        ...(partFixture().parameters as Record<string, unknown>),
        package: {
          ...((partFixture().parameters as Record<string, Record<string, unknown>>).package ?? {}),
          provenance: distributorProvenance(),
        },
      },
    });

    const outcome = applyVerdicts(
      fromDistributor,
      all(() => ({ verdict: 'confirmed' })),
      clock,
    );

    expect(outcome.unchecked).toEqual(['package']);
    expect(outcome.part.status).toBe('extracted');
  });

  it('counts a parameter no verdict covered as unchecked, and leaves the status alone', () => {
    const outcome = applyVerdicts(
      part(),
      new Map([['vinMax', verdict({ parameterKey: 'vinMax' })]]),
      clock,
    );

    expect(outcome.confirmed).toEqual(['vinMax']);
    expect(outcome.unchecked).toHaveLength(PARAMETER_KEYS.length - 1);
    expect(outcome.part.status).toBe('extracted');
    expect(outcome.part.updatedAt).toBe(LATER);
    expect(outcome.part.createdAt).toBe(NOW);
  });
});
