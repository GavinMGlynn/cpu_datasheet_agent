import { describe, expect, it } from 'vitest';

import type { ObservedValue } from '../core/observation.js';
import type { ParameterKey } from '../core/parameter-keys.js';
import { compareObservation, describeExtracted, describeObserved } from './compare.js';
import { ReconcileError } from './errors.js';
import { PARAMETER_POLICIES } from './policy.js';
import type { ParameterValue } from './types.js';

function verdict(key: ParameterKey, extracted: ParameterValue, observed: ObservedValue): string {
  return compareObservation(key, extracted, observed, PARAMETER_POLICIES[key]).verdict;
}

const volts = (value: number): ObservedValue => ({ kind: 'quantity', value: { value, unit: 'V' } });
const hertz = (value: number): ObservedValue => ({
  kind: 'quantity',
  value: { value, unit: 'Hz' },
});

describe('numeric comparison', () => {
  it('accepts a difference inside the tolerance and rejects one outside it', () => {
    // vinMax allows two percent: 28 V against 28.5 V is rounding, 30 V is not.
    expect(verdict('vinMax', { value: 28, unit: 'V' }, volts(28.5))).toBe('agree');
    expect(verdict('vinMax', { value: 28, unit: 'V' }, volts(30))).toBe('conflict');
  });

  it('reads an exact tolerance as exact', () => {
    expect(
      verdict(
        'operatingTempMax',
        { value: 125, unit: 'degC' },
        { kind: 'quantity', value: { value: 125, unit: 'degC' } },
      ),
    ).toBe('agree');
    expect(
      verdict(
        'operatingTempMax',
        { value: 125, unit: 'degC' },
        { kind: 'quantity', value: { value: 150, unit: 'degC' } },
      ),
    ).toBe('conflict');
  });

  it('treats an upper bound as a limit not to exceed', () => {
    const upTo1MHz: ObservedValue = { kind: 'max', value: { value: 1_000_000, unit: 'Hz' } };
    expect(verdict('switchingFrequency', { value: 570_000, unit: 'Hz' }, upTo1MHz)).toBe('agree');
    expect(verdict('switchingFrequency', { value: 2_200_000, unit: 'Hz' }, upTo1MHz)).toBe(
      'conflict',
    );
    // A range is judged by the end the bound speaks about.
    expect(
      verdict('switchingFrequency', { unit: 'Hz', min: 100_000, max: 900_000 }, upTo1MHz),
    ).toBe('agree');
    expect(
      verdict('switchingFrequency', { unit: 'Hz', min: 100_000, max: 1_500_000 }, upTo1MHz),
    ).toBe('conflict');
  });

  it('treats a lower bound the same way', () => {
    const from100kHz: ObservedValue = { kind: 'min', value: { value: 100_000, unit: 'Hz' } };
    expect(verdict('switchingFrequency', { value: 570_000, unit: 'Hz' }, from100kHz)).toBe('agree');
    expect(verdict('switchingFrequency', { value: 50_000, unit: 'Hz' }, from100kHz)).toBe(
      'conflict',
    );
    expect(
      verdict('switchingFrequency', { unit: 'Hz', min: 200_000, max: 2_200_000 }, from100kHz),
    ).toBe('agree');
    expect(
      verdict('switchingFrequency', { unit: 'Hz', min: 50_000, max: 2_200_000 }, from100kHz),
    ).toBe('conflict');
  });

  it('reads a single value against a range as containment', () => {
    const range: ObservedValue = {
      kind: 'range',
      value: { unit: 'Hz', min: 100_000, max: 1_500_000 },
    };
    expect(verdict('switchingFrequency', { value: 500_000, unit: 'Hz' }, range)).toBe('agree');
    expect(verdict('switchingFrequency', { value: 2_200_000, unit: 'Hz' }, range)).toBe('conflict');
    // And a range against a single value the same way round.
    expect(
      verdict('switchingFrequency', { unit: 'Hz', min: 100_000, max: 1_500_000 }, hertz(500_000)),
    ).toBe('agree');
    expect(
      verdict('switchingFrequency', { unit: 'Hz', min: 100_000, max: 1_500_000 }, hertz(2_200_000)),
    ).toBe('conflict');
  });

  it('compares two ranges end by end', () => {
    const mine = { unit: 'Hz', min: 100_000, max: 1_500_000 } as const;
    expect(
      verdict('switchingFrequency', mine, {
        kind: 'range',
        value: { unit: 'Hz', min: 100_000, max: 1_500_000 },
      }),
    ).toBe('agree');
    expect(
      verdict('switchingFrequency', mine, {
        kind: 'range',
        value: { unit: 'Hz', min: 100_000, max: 2_200_000 },
      }),
    ).toBe('conflict');
  });
});

describe('a stored limit', () => {
  const upTo1MHz = { unit: 'Hz', max: 1_000_000 } as const;

  it('agrees with the same limit, which is the one thing that corroborates it', () => {
    expect(
      verdict('switchingFrequency', upTo1MHz, {
        kind: 'max',
        value: { value: 1_000_000, unit: 'Hz' },
      }),
    ).toBe('agree');
    expect(
      verdict('switchingFrequency', upTo1MHz, {
        kind: 'max',
        value: { value: 2_200_000, unit: 'Hz' },
      }),
    ).toBe('conflict');
  });

  it('is contradicted by a value beyond it', () => {
    expect(verdict('switchingFrequency', upTo1MHz, hertz(2_200_000))).toBe('conflict');
    expect(
      verdict('switchingFrequency', upTo1MHz, {
        kind: 'range',
        value: { unit: 'Hz', min: 100_000, max: 2_200_000 },
      }),
    ).toBe('conflict');
  });

  it('is not confirmed by a value inside it: both are true of the same part', () => {
    expect(verdict('switchingFrequency', upTo1MHz, hertz(570_000))).toBe('incomparable');
    expect(
      verdict('switchingFrequency', upTo1MHz, {
        kind: 'range',
        value: { unit: 'Hz', min: 100_000, max: 900_000 },
      }),
    ).toBe('incomparable');
  });

  it('reads a lower limit the same way round', () => {
    const from100kHz = { unit: 'Hz', min: 100_000 } as const;
    expect(
      verdict('switchingFrequency', from100kHz, {
        kind: 'min',
        value: { value: 100_000, unit: 'Hz' },
      }),
    ).toBe('agree');
    expect(verdict('switchingFrequency', from100kHz, hertz(50_000))).toBe('conflict');
    expect(verdict('switchingFrequency', from100kHz, hertz(570_000))).toBe('incomparable');
    expect(
      verdict('switchingFrequency', from100kHz, {
        kind: 'max',
        value: { value: 1_000_000, unit: 'Hz' },
      }),
    ).toBe('incomparable');
    // A range is judged by its lower end against a lower limit.
    expect(
      verdict('switchingFrequency', from100kHz, {
        kind: 'range',
        value: { unit: 'Hz', min: 200_000, max: 2_200_000 },
      }),
    ).toBe('incomparable');
    expect(
      verdict('switchingFrequency', from100kHz, {
        kind: 'range',
        value: { unit: 'Hz', min: 50_000, max: 2_200_000 },
      }),
    ).toBe('conflict');
  });

  it('has nothing to say about a value that is not a number', () => {
    expect(verdict('switchingFrequency', upTo1MHz, { kind: 'enum', value: 'fixed' })).toBe(
      'incomparable',
    );
    expect(verdict('switchingFrequency', upTo1MHz, { kind: 'boolean', value: true })).toBe(
      'incomparable',
    );
    expect(verdict('switchingFrequency', upTo1MHz, { kind: 'text', value: '570 kHz' })).toBe(
      'incomparable',
    );
  });

  it('reads a limit of the other kind as a value inside or beyond it', () => {
    // An upper limit against a stated lower bound: the two speak about
    // different ends, so only exceeding decides anything.
    expect(
      verdict('switchingFrequency', upTo1MHz, {
        kind: 'min',
        value: { value: 100_000, unit: 'Hz' },
      }),
    ).toBe('incomparable');
    expect(
      verdict('switchingFrequency', upTo1MHz, {
        kind: 'min',
        value: { value: 2_200_000, unit: 'Hz' },
      }),
    ).toBe('conflict');
  });

  it('reads back as the limit it is', () => {
    expect(describeExtracted(upTo1MHz)).toBe('at most 1 MHz');
    expect(describeExtracted({ unit: 'Hz', min: 100_000 })).toBe('at least 100 kHz');
  });
});

describe('non-numeric comparison', () => {
  it('compares enumerations by their value', () => {
    expect(verdict('topology', 'synchronous', { kind: 'enum', value: 'synchronous' })).toBe(
      'agree',
    );
    expect(verdict('topology', 'synchronous', { kind: 'enum', value: 'non_synchronous' })).toBe(
      'conflict',
    );
  });

  it('compares booleans directly', () => {
    expect(verdict('enablePin', true, { kind: 'boolean', value: true })).toBe('agree');
    expect(verdict('enablePin', true, { kind: 'boolean', value: false })).toBe('conflict');
  });

  it('compares soft start on whether the part has it', () => {
    const present = { present: true, time: { value: 0.002, unit: 's' } } as const;
    expect(verdict('softStart', present, { kind: 'boolean', value: true })).toBe('agree');
    expect(verdict('softStart', present, { kind: 'boolean', value: false })).toBe('conflict');
  });

  it('reads a null fixed output as adjustable', () => {
    expect(verdict('voutFixed', null, { kind: 'enum', value: 'adjustable' })).toBe('agree');
    expect(verdict('voutFixed', null, { kind: 'enum', value: 'fixed' })).toBe('conflict');
    expect(verdict('voutFixed', { value: 3.3, unit: 'V' }, { kind: 'enum', value: 'fixed' })).toBe(
      'agree',
    );
    expect(
      verdict('voutFixed', { value: 3.3, unit: 'V' }, { kind: 'enum', value: 'adjustable' }),
    ).toBe('conflict');
  });

  it('compares a listed fixed voltage with the stored one', () => {
    expect(verdict('voutFixed', { value: 3.3, unit: 'V' }, volts(3.3))).toBe('agree');
    expect(verdict('voutFixed', { value: 3.3, unit: 'V' }, volts(5))).toBe('conflict');
    // An adjustable part listed with a fixed voltage is a disagreement.
    expect(verdict('voutFixed', null, volts(3.3))).toBe('conflict');
  });
});

describe('package comparison', () => {
  it('compares shape families, not words', () => {
    expect(
      verdict('package', '8-SOIC PowerPAD (DDA)', {
        kind: 'text',
        value: '8-PowerSOIC (0.154", 3.90mm Width)',
      }),
    ).toBe('agree');
    expect(
      verdict('package', 'VSSOP-8 (DGK)', {
        kind: 'text',
        value: '8-PowerSOIC (0.154", 3.90mm Width)',
      }),
    ).toBe('conflict');
  });

  it('conflicts when the families agree but the lead counts do not', () => {
    expect(
      verdict('package', 'SOIC-14', { kind: 'text', value: '8-SOIC (0.154", 3.90mm Width)' }),
    ).toBe('conflict');
  });

  it('agrees when only one side states a lead count', () => {
    expect(
      verdict('package', 'SOIC', { kind: 'text', value: '8-SOIC (0.154", 3.90mm Width)' }),
    ).toBe('agree');
  });

  it.each([
    ['a text naming no family', 'Cylinder, Threaded'],
    ['a family outside the vocabulary', '20-UFBGA, WLCSP'],
  ])('leaves %s incomparable', (_label, text) => {
    expect(verdict('package', 'SOIC-8', { kind: 'text', value: text })).toBe('incomparable');
    expect(verdict('package', text, { kind: 'text', value: '8-SOIC (0.154", 3.90mm Width)' })).toBe(
      'incomparable',
    );
  });
});

describe('shape mismatches', () => {
  it.each([
    [
      'a boolean against a voltage',
      'vinMax',
      { value: 28, unit: 'V' },
      { kind: 'boolean', value: true },
    ],
    [
      'text against a voltage',
      'vinMax',
      { value: 28, unit: 'V' },
      { kind: 'text', value: 'SOIC-8' },
    ],
    [
      'an enum against a voltage',
      'vinMax',
      { value: 28, unit: 'V' },
      { kind: 'enum', value: 'fixed' },
    ],
    ['a quantity against a boolean', 'enablePin', true, volts(3)],
    ['a quantity against soft start', 'softStart', { present: true, time: null }, volts(3)],
    ['a quantity against an enum', 'topology', 'synchronous', volts(3)],
    [
      'a range against a package',
      'package',
      'SOIC-8',
      { kind: 'range', value: { unit: 'V', min: 1, max: 2 } },
    ],
    ['a boolean against a fixed output', 'voutFixed', null, { kind: 'boolean', value: true }],
    ['an unknown output type', 'voutFixed', null, { kind: 'enum', value: 'switchable' }],
    ['a value with no shape at all', 'vinMax', null, volts(3)],
  ])('refuses to compare %s', (_label, key, extracted, observed) => {
    expect(() =>
      compareObservation(
        key as ParameterKey,
        extracted as ParameterValue,
        observed as ObservedValue,
        PARAMETER_POLICIES[key as ParameterKey],
      ),
    ).toThrow(ReconcileError);
  });

  it('names the parameter and the kind it could not compare', () => {
    try {
      compareObservation(
        'vinMax',
        { value: 28, unit: 'V' },
        { kind: 'boolean', value: true },
        PARAMETER_POLICIES.vinMax,
      );
      expect.unreachable();
    } catch (error) {
      expect((error as ReconcileError).code).toBe('RECONCILE_SHAPE_MISMATCH');
      expect((error as ReconcileError).details).toMatchObject({ key: 'vinMax', kind: 'boolean' });
    }
  });
});

describe('descriptions', () => {
  it.each([
    [{ kind: 'quantity', value: { value: 570_000, unit: 'Hz' } }, '570 kHz'],
    [{ kind: 'max', value: { value: 1_000_000, unit: 'Hz' } }, 'at most 1 MHz'],
    [{ kind: 'min', value: { value: 3, unit: 'V' } }, 'at least 3 V'],
    [{ kind: 'range', value: { unit: 'Hz', min: 100_000, max: 1_500_000 } }, '100000 ~ 1500000 Hz'],
    [{ kind: 'enum', value: 'adjustable' }, 'adjustable'],
    [{ kind: 'boolean', value: true }, 'yes'],
    [{ kind: 'boolean', value: false }, 'no'],
    [{ kind: 'text', value: 'SOIC-8' }, 'SOIC-8'],
  ])('describes %j as %s', (observed, expected) => {
    expect(describeObserved(observed as ObservedValue)).toBe(expected);
  });

  it.each([
    [null, 'not stated'],
    [true, 'yes'],
    [false, 'no'],
    ['SOIC-8', 'SOIC-8'],
    [{ value: 3.3, unit: 'V' }, '3.3 V'],
    [{ unit: 'Hz', min: 100_000, max: 1_500_000 }, '100000 ~ 1500000 Hz'],
    [{ present: false, time: null }, 'no'],
    [{ present: true, time: null }, 'yes'],
    [{ present: true, time: { value: 0.002, unit: 's' } }, 'yes, 2 ms'],
  ])('describes the stored %j as %s', (value, expected) => {
    expect(describeExtracted(value as ParameterValue)).toBe(expected);
  });
});
