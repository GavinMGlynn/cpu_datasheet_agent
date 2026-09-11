import { describe, expect, it } from 'vitest';

import { buckParameters, param, q } from '../../test/helpers/core-fixtures.js';
import { BuckRegulatorParameters } from '../core/buck-regulator.js';
import { CLASSIFICATION_AXES, type Classification } from '../core/classification.js';
import { parseOrThrow } from '../core/validation-error.js';
import { classify, tryClassify } from './classify.js';
import { ClassifyError } from './errors.js';
import { CLASSIFICATION_RULES } from './rules.js';
import type { ParameterSet } from './types.js';

/** The fixture part, validated, so every rule reads schema-shaped values. */
function parameters(overrides: Record<string, unknown> = {}): BuckRegulatorParameters {
  return parseOrThrow(BuckRegulatorParameters, buckParameters(overrides), 'parameters');
}

function valueOn(result: readonly Classification[], axis: string): unknown {
  return result.find((classification) => classification.axis === axis)?.value;
}

describe('CLASSIFICATION_RULES', () => {
  it('covers every axis exactly once, with a distinct rule id', () => {
    expect(CLASSIFICATION_RULES.map((rule) => rule.axis).sort()).toEqual(
      [...CLASSIFICATION_AXES].sort(),
    );
    expect(new Set(CLASSIFICATION_RULES.map((rule) => rule.id)).size).toBe(
      CLASSIFICATION_RULES.length,
    );
  });

  it('records the rule id and the parameters it read on every classification', () => {
    for (const classification of classify(parameters())) {
      const rule = CLASSIFICATION_RULES.find((candidate) => candidate.axis === classification.axis);
      expect(classification.rule).toBe(rule?.id);
      expect([...classification.derivedFrom].sort()).toEqual([...(rule?.needs ?? [])].sort());
    }
  });
});

describe('vinClass', () => {
  it.each([
    [3.3, 'le_5v5'],
    [5.5, 'le_5v5'],
    [5.51, 'le_18v'],
    [18, 'le_18v'],
    [28, 'le_42v'],
    [42, 'le_42v'],
    [60, 'le_60v'],
    [65, 'gt_60v'],
    [100, 'gt_60v'],
  ])('reads a %i V maximum as %s', (volts, expected) => {
    const set = parameters({
      vinMin: param(q(Math.min(3, volts / 2), 'V')),
      vinMax: param(q(volts, 'V')),
      vinAbsMax: param(q(volts + 5, 'V')),
    });
    expect(valueOn(classify(set), 'vinClass')).toBe(expected);
  });
});

describe('ioutClass', () => {
  it.each([
    [0.5, 'le_1a'],
    [1, 'le_1a'],
    [3, 'le_3a'],
    [3.5, 'le_6a'],
    [6, 'le_6a'],
    [12, 'le_12a'],
    [20, 'gt_12a'],
  ])('reads a %i A output as %s', (amps, expected) => {
    expect(valueOn(classify(parameters({ ioutMax: param(q(amps, 'A')) })), 'ioutClass')).toBe(
      expected,
    );
  });
});

describe('topology, integration and outputType', () => {
  it('carries topology and integration through unchanged', () => {
    const result = classify(parameters());
    expect(valueOn(result, 'topology')).toBe('non_synchronous');
    expect(valueOn(result, 'integration')).toBe('integrated_fet');
  });

  it('reads a null fixed output as adjustable and a value as fixed', () => {
    expect(valueOn(classify(parameters()), 'outputType')).toBe('adjustable');
    const fixed = parameters({
      voutFixed: param(q(3.3, 'V')),
      voutMin: param(q(3.3, 'V')),
      voutMax: param(q(3.3, 'V')),
    });
    expect(valueOn(classify(fixed), 'outputType')).toBe('fixed');
  });
});

describe('packageFamily', () => {
  it.each([
    ['8-SOIC (0.154", 3.90mm Width)', 'soic'],
    ['SOT-23-6 Thin, TSOT-23-6', 'sot23'],
    ['20-UFBGA, WLCSP', 'other'],
  ])('reads %s as %s', (text, expected) => {
    expect(valueOn(classify(parameters({ package: param(text) })), 'packageFamily')).toBe(expected);
  });

  it('leaves the axis undecided when the text names no family', () => {
    const result = tryClassify(parameters({ package: param('Cylinder, Threaded') }));
    expect(result.undecided).toEqual([
      {
        axis: 'packageFamily',
        missing: [],
        reason: '"Cylinder, Threaded" names no package family',
      },
    ]);
  });
});

describe('temperatureGrade', () => {
  function graded(min: number, max: number, aecQ100 = false): unknown {
    return valueOn(
      classify(
        parameters({
          operatingTempMin: param(q(min, 'degC')),
          operatingTempMax: param(q(max, 'degC')),
          aecQ100: param(aecQ100),
        }),
      ),
      'temperatureGrade',
    );
  }

  it.each([
    [0, 70, 'commercial'],
    [-20, 85, 'commercial'],
    [0, 125, 'commercial'],
    [-40, 85, 'industrial'],
    [-40, 105, 'industrial'],
    [-40, 125, 'extended'],
    [-40, 150, 'extended'],
    [-55, 125, 'extended'],
  ])('reads %i °C to %i °C as %s', (min, max, expected) => {
    expect(graded(min, max)).toBe(expected);
  });

  it('reads an AEC-Q100 part as automotive whatever its range', () => {
    expect(graded(-40, 125, true)).toBe('automotive');
    expect(graded(0, 70, true)).toBe('automotive');
  });

  it('leaves a range covering no grade undecided', () => {
    const result = tryClassify(
      parameters({
        operatingTempMin: param(q(-25, 'degC')),
        operatingTempMax: param(q(60, 'degC')),
      }),
    );
    expect(result.undecided).toEqual([
      {
        axis: 'temperatureGrade',
        missing: [],
        reason: '-25 °C to 60 °C covers no grade’s full range'.replace('’', "'"),
      },
    ]);
  });
});

describe('features', () => {
  it('lists only the features the part has', () => {
    // The fixture part has an enable pin and soft start, and nothing else.
    expect(valueOn(classify(parameters()), 'features')).toEqual(['enable', 'soft_start']);
  });

  it.each([
    ['pfm', true],
    ['psm', true],
    ['selectable', true],
    ['forced_pwm', false],
    ['none', false],
  ])('counts %s as a light-load feature: %s', (mode, expected) => {
    const features = valueOn(classify(parameters({ lightLoadMode: param(mode) })), 'features');
    expect((features as string[]).includes('light_load')).toBe(expected);
  });

  it('lists every feature in vocabulary order', () => {
    const set = parameters({
      enablePin: param(true),
      powerGoodPin: param(true),
      softStart: param({ present: true, time: null }),
      externalSync: param(true),
      lightLoadMode: param('pfm'),
    });
    expect(valueOn(classify(set), 'features')).toEqual([
      'enable',
      'power_good',
      'soft_start',
      'sync',
      'light_load',
    ]);
  });

  it('returns an empty list for a part with none of them', () => {
    const set = parameters({
      enablePin: param(false),
      powerGoodPin: param(false),
      softStart: param({ present: false, time: null }),
      externalSync: param(false),
      lightLoadMode: param('forced_pwm'),
    });
    expect(valueOn(classify(set), 'features')).toEqual([]);
  });
});

describe('classify', () => {
  it('returns one classification per axis for a complete parameter set', () => {
    const result = classify(parameters());
    expect(result.map((classification) => classification.axis).sort()).toEqual(
      [...CLASSIFICATION_AXES].sort(),
    );
    expect(tryClassify(parameters()).undecided).toEqual([]);
  });

  it('throws rather than returning a partial answer', () => {
    const partial: ParameterSet = { vinMax: parameters().vinMax };
    expect(() => classify(partial)).toThrow(ClassifyError);
    try {
      classify(partial);
    } catch (error) {
      expect(error).toBeInstanceOf(ClassifyError);
      const details = (error as ClassifyError).details;
      expect((error as ClassifyError).code).toBe('CLASSIFY_INCOMPLETE');
      expect(details.missing).toEqual([
        'ioutMax',
        'topology',
        'integration',
        'voutFixed',
        'package',
        'operatingTempMin',
        'operatingTempMax',
        'aecQ100',
        'enablePin',
        'powerGoodPin',
        'softStart',
        'externalSync',
        'lightLoadMode',
      ]);
    }
    expect(tryClassify(partial).classifications).toHaveLength(1);
  });

  it('names the parameters each undecided axis needed', () => {
    const result = tryClassify({});
    expect(result.classifications).toEqual([]);
    expect(result.undecided.map((axis) => axis.axis).sort()).toEqual(
      [...CLASSIFICATION_AXES].sort(),
    );
    expect(result.undecided.find((axis) => axis.axis === 'features')?.missing).toEqual([
      'enablePin',
      'powerGoodPin',
      'softStart',
      'externalSync',
      'lightLoadMode',
    ]);
  });
});
