import { describe, expect, it } from 'vitest';

import {
  NOW,
  UUID,
  buckParameters,
  distributorProvenance,
  param,
  q,
} from '../../test/helpers/core-fixtures.js';
import { BuckRegulatorParameters } from '../core/buck-regulator.js';
import { PARAMETER_KEYS } from '../core/parameter-keys.js';
import type { DistributorProvenance } from '../core/provenance.js';
import { parseOrThrow } from '../core/validation-error.js';
import type { DistributorFact } from '../units/index.js';
import { reconcile, type ReconcileOutcome, type ReconciledParameter } from './reconcile.js';
import type { DistributorParametrics, ParameterSet } from './types.js';

const DEPS = { now: () => NOW, newId: () => UUID };

function parameters(overrides: Record<string, unknown> = {}): BuckRegulatorParameters {
  return parseOrThrow(BuckRegulatorParameters, buckParameters(overrides), 'parameters');
}

function provenance(overrides: Record<string, unknown> = {}): DistributorProvenance {
  return distributorProvenance(overrides) as unknown as DistributorProvenance;
}

function source(
  facts: DistributorFact[],
  overrides: Record<string, unknown> = {},
): DistributorParametrics {
  return { provenance: provenance(overrides), facts };
}

function run(parameterSet: ParameterSet, sources: readonly DistributorParametrics[]) {
  return reconcile({ mpn: 'TPS54331DR', parameters: parameterSet, sources }, DEPS);
}

function on(
  result: { parameters: readonly ReconciledParameter[] },
  key: string,
): ReconciledParameter {
  const found = result.parameters.find((parameter) => parameter.key === key);
  if (found === undefined) {
    throw new Error(`no outcome for ${key}`);
  }
  return found;
}

function outcome(
  result: { parameters: readonly ReconciledParameter[] },
  key: string,
): ReconcileOutcome {
  return on(result, key).outcome;
}

/** Digi-Key's reading of the fixture part, as the fixtures record it. */
const DIGIKEY: DistributorFact[] = [
  { kind: 'quantity', key: 'vinMin', value: { value: 3.5, unit: 'V' } },
  { kind: 'quantity', key: 'vinMax', value: { value: 28, unit: 'V' } },
  { kind: 'quantity', key: 'ioutMax', value: { value: 3, unit: 'A' } },
  { kind: 'quantity', key: 'switchingFrequency', value: { value: 570_000, unit: 'Hz' } },
  { kind: 'enum', key: 'topology', value: 'non_synchronous' },
  { kind: 'enum', key: 'voutFixed', value: 'adjustable' },
  { kind: 'text', key: 'package', value: '8-SOIC (0.154", 3.90mm Width)' },
];

describe('reconcile', () => {
  it('agrees with a distributor that restates the datasheet', () => {
    const result = run(parameters(), [source(DIGIKEY)]);
    for (const key of [
      'vinMin',
      'vinMax',
      'ioutMax',
      'switchingFrequency',
      'topology',
      'voutFixed',
      'package',
    ]) {
      expect(outcome(result, key)).toBe('agree');
    }
    expect(result.escalations).toEqual([]);
    expect(result.updated).toEqual(parameters());
  });

  it('reports a parameter only the datasheet states', () => {
    const result = run(parameters(), [source([])]);
    expect(outcome(result, 'feedbackReference')).toBe('datasheet_only');
    expect(on(result, 'feedbackReference').observations).toEqual([]);
  });

  it('reports a parameter only the distributor states', () => {
    const extracted = parameters();
    const set: ParameterSet = { vinMax: extracted.vinMax };
    const result = run(set, [source(DIGIKEY)]);
    expect(outcome(result, 'ioutMax')).toBe('distributor_only');
    expect(on(result, 'ioutMax').comparisons).toEqual([]);
    expect(on(result, 'ioutMax').observations).toHaveLength(1);
    // Nothing is adopted: a value with no page behind it is not extracted.
    expect(result.updated).toEqual(set);
  });

  it('reads a null value as the datasheet not stating the parameter', () => {
    const result = run(parameters(), [
      source([
        { kind: 'quantity', key: 'shutdownCurrent', value: { value: 0.000_002, unit: 'A' } },
      ]),
    ]);
    // The fixture states a shutdown current, so this one is compared.
    expect(outcome(result, 'shutdownCurrent')).toBe('conflict');
    const withoutIt = run(parameters({ shutdownCurrent: param(null) }), [
      source([
        { kind: 'quantity', key: 'shutdownCurrent', value: { value: 0.000_002, unit: 'A' } },
      ]),
    ]);
    expect(outcome(withoutIt, 'shutdownCurrent')).toBe('distributor_only');
  });

  it('skips a parameter neither side states', () => {
    const result = run({}, [source([])]);
    expect(result.parameters).toEqual([]);
  });

  it('keeps parameters in schema order', () => {
    const keys = run(parameters(), [source(DIGIKEY)]).parameters.map((parameter) => parameter.key);
    expect(keys).toEqual(PARAMETER_KEYS.filter((key) => keys.includes(key)));
  });
});

describe('conflicts', () => {
  it('keeps the datasheet value, records the distributor value and marks the parameter', () => {
    const result = run(parameters(), [
      source([{ kind: 'quantity', key: 'voutMax', value: { value: 30, unit: 'V' } }]),
    ]);
    expect(outcome(result, 'voutMax')).toBe('conflict');
    const stored = result.updated.voutMax;
    expect(stored?.value).toEqual({ value: 25, unit: 'V' });
    expect(stored?.confidence).toBe('conflict');
    expect(stored?.conflicts).toEqual([
      {
        observed: { kind: 'quantity', value: { value: 30, unit: 'V' } },
        provenance: provenance(),
        rule: 'quantity-tolerance.v1',
      },
    ]);
    // A non-safety conflict is recorded, not escalated.
    expect(result.escalations).toEqual([]);
  });

  it('escalates a conflict on a safety parameter and never resolves it', () => {
    const result = run(parameters(), [
      source([{ kind: 'quantity', key: 'vinMax', value: { value: 36, unit: 'V' } }]),
    ]);
    expect(outcome(result, 'vinMax')).toBe('conflict');
    expect(result.updated.vinMax?.value).toEqual({ value: 28, unit: 'V' });
    expect(result.escalations).toHaveLength(1);
    const escalation = result.escalations[0];
    expect(escalation?.kind).toBe('conflict');
    expect(escalation?.mpn).toBe('TPS54331DR');
    expect(escalation?.question).toContain('28 V');
    expect(escalation?.question).toContain('36 V');
    expect(escalation?.question).toContain('page 4');
    expect(escalation?.options).toEqual([
      'datasheet: 28 V (page 4)',
      'digikey 296-28446-1-ND: 36 V',
    ]);
    expect(escalation?.context).toMatchObject({ parameter: 'vinMax', page: 4 });
  });

  it('escalates once per parameter however many distributors disagree', () => {
    const result = run(parameters(), [
      source([{ kind: 'quantity', key: 'ioutMax', value: { value: 4, unit: 'A' } }]),
      source([{ kind: 'quantity', key: 'ioutMax', value: { value: 5, unit: 'A' } }], {
        distributor: 'mouser',
        sku: '595-TPS54331DR',
      }),
    ]);
    expect(result.escalations).toHaveLength(1);
    expect(result.escalations[0]?.options).toHaveLength(3);
    expect(result.updated.ioutMax?.conflicts).toHaveLength(2);
  });

  it('omits the page when the value did not come from a datasheet', () => {
    const extracted = parameters({
      vinMax: {
        value: q(28, 'V'),
        provenance: { source: 'human', note: 'read from the ordering guide', recordedAt: NOW },
        confidence: 'extracted',
      },
    });
    const result = run(extracted, [
      source([{ kind: 'quantity', key: 'vinMax', value: { value: 36, unit: 'V' } }]),
    ]);
    expect(result.escalations[0]?.question).not.toContain('page');
    expect(result.escalations[0]?.context).not.toHaveProperty('page');
  });

  it('conflicts when one distributor disagrees even though another agrees', () => {
    const result = run(parameters(), [
      source([{ kind: 'quantity', key: 'vinMax', value: { value: 28, unit: 'V' } }]),
      source([{ kind: 'quantity', key: 'vinMax', value: { value: 36, unit: 'V' } }], {
        distributor: 'mouser',
        sku: '595-TPS54331DR',
      }),
    ]);
    expect(outcome(result, 'vinMax')).toBe('conflict');
  });
});

describe('several observations of one parameter', () => {
  it('lets one agreeing package description settle the package', () => {
    // Digi-Key states the package twice, and its own two fields disagree on
    // some parts. One of them agreeing is enough.
    const result = run(parameters({ package: param('8-SOIC PowerPAD') }), [
      source([
        { kind: 'text', key: 'package', value: '8-PowerSOIC (0.154", 3.90mm Width)' },
        { kind: 'text', key: 'package', value: '8-VFDFN Exposed Pad' },
      ]),
    ]);
    expect(outcome(result, 'package')).toBe('agree');
    expect(result.updated.package?.confidence).toBe('extracted');
  });

  it('conflicts when no package description agrees', () => {
    const result = run(parameters({ package: param('8-SOIC PowerPAD') }), [
      source([
        { kind: 'text', key: 'package', value: '8-VFDFN Exposed Pad' },
        { kind: 'text', key: 'package', value: '8-QFN (3x3)' },
      ]),
    ]);
    expect(outcome(result, 'package')).toBe('conflict');
    expect(result.updated.package?.conflicts).toHaveLength(2);
  });

  it('is datasheet_only when every observation is incomparable', () => {
    const result = run(parameters({ package: param('8-SOIC PowerPAD') }), [
      source([{ kind: 'text', key: 'package', value: 'Cylinder, Threaded' }]),
    ]);
    expect(outcome(result, 'package')).toBe('datasheet_only');
    expect(on(result, 'package').comparisons[0]?.verdict).toBe('incomparable');
    expect(result.updated.package?.confidence).toBe('extracted');
  });
});
