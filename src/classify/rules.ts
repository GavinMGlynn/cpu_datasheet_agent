import type { Classification, ClassificationAxis } from '../core/classification.js';
import type { ParameterKey } from '../core/parameter-keys.js';
import { parsePackage } from './package-shape.js';
import type { ParameterSet } from './types.js';
import { requireValues } from './values.js';

/** What a rule produced: a classification, or the reason it produced none. */
export type RuleOutcome =
  | { readonly kind: 'classified'; readonly classification: Classification }
  | {
      readonly kind: 'undecided';
      readonly missing: readonly ParameterKey[];
      readonly reason: string;
    };

export interface ClassificationRule {
  readonly axis: ClassificationAxis;
  /** Stable identifier recorded on every classification the rule produces. */
  readonly id: string;
  /** Parameters the rule reads. */
  readonly needs: readonly ParameterKey[];
  readonly apply: (parameters: ParameterSet) => RuleOutcome;
}

function undecidedBecause(reason: string, missing: readonly ParameterKey[] = []): RuleOutcome {
  return { kind: 'undecided', missing, reason };
}

function missingParameters(missing: readonly ParameterKey[]): RuleOutcome {
  return undecidedBecause(`needs ${missing.join(', ')}`, missing);
}

/** Upper bounds in ascending order; a value at or below one takes its class. */
const VIN_BANDS: readonly (readonly [number, 'le_5v5' | 'le_18v' | 'le_42v' | 'le_60v'])[] = [
  [5.5, 'le_5v5'],
  [18, 'le_18v'],
  [42, 'le_42v'],
  [60, 'le_60v'],
];

const IOUT_BANDS: readonly (readonly [number, 'le_1a' | 'le_3a' | 'le_6a' | 'le_12a'])[] = [
  [1, 'le_1a'],
  [3, 'le_3a'],
  [6, 'le_6a'],
  [12, 'le_12a'],
];

function band<T>(value: number, bands: readonly (readonly [number, T])[], above: T): T {
  for (const [limit, name] of bands) {
    if (value <= limit) {
      return name;
    }
  }
  return above;
}

/**
 * Temperature envelopes, widest first. A part takes the grade of the widest
 * envelope its operating range covers completely, so a 0 °C to 125 °C part is
 * commercial: it does not reach industrial's -40 °C, and claiming that it does
 * is the error that matters.
 */
const TEMPERATURE_ENVELOPES: readonly (readonly [
  number,
  number,
  'extended' | 'industrial' | 'commercial',
])[] = [
  [-40, 125, 'extended'],
  [-40, 85, 'industrial'],
  [0, 70, 'commercial'],
];

/** Light-load modes that give the part a light-load feature. */
const LIGHT_LOAD_MODES = new Set(['pfm', 'psm', 'selectable']);

export const CLASSIFICATION_RULES: readonly ClassificationRule[] = Object.freeze([
  {
    axis: 'vinClass',
    id: 'vin-class.v1',
    needs: ['vinMax'],
    apply: (parameters) => {
      const got = requireValues(parameters, ['vinMax'] as const);
      if (!got.ok) {
        return missingParameters(got.missing);
      }
      return {
        kind: 'classified',
        classification: {
          axis: 'vinClass',
          value: band(got.values.vinMax.value, VIN_BANDS, 'gt_60v'),
          derivedFrom: ['vinMax'],
          rule: 'vin-class.v1',
        },
      };
    },
  },
  {
    axis: 'ioutClass',
    id: 'iout-class.v1',
    needs: ['ioutMax'],
    apply: (parameters) => {
      const got = requireValues(parameters, ['ioutMax'] as const);
      if (!got.ok) {
        return missingParameters(got.missing);
      }
      const ioutMax = got.values.ioutMax;
      if (ioutMax === null) {
        // A controller has no output current of its own: it is whatever the
        // external FETs and inductor allow.
        return undecidedBecause('ioutMax is null, as it is for a controller');
      }
      return {
        kind: 'classified',
        classification: {
          axis: 'ioutClass',
          value: band(ioutMax.value, IOUT_BANDS, 'gt_12a'),
          derivedFrom: ['ioutMax'],
          rule: 'iout-class.v1',
        },
      };
    },
  },
  {
    axis: 'topology',
    id: 'topology.v1',
    needs: ['topology'],
    apply: (parameters) => {
      const got = requireValues(parameters, ['topology'] as const);
      if (!got.ok) {
        return missingParameters(got.missing);
      }
      return {
        kind: 'classified',
        classification: {
          axis: 'topology',
          value: got.values.topology,
          derivedFrom: ['topology'],
          rule: 'topology.v1',
        },
      };
    },
  },
  {
    axis: 'integration',
    id: 'integration.v1',
    needs: ['integration'],
    apply: (parameters) => {
      const got = requireValues(parameters, ['integration'] as const);
      if (!got.ok) {
        return missingParameters(got.missing);
      }
      return {
        kind: 'classified',
        classification: {
          axis: 'integration',
          value: got.values.integration,
          derivedFrom: ['integration'],
          rule: 'integration.v1',
        },
      };
    },
  },
  {
    axis: 'outputType',
    id: 'output-type.v1',
    needs: ['voutFixed'],
    apply: (parameters) => {
      const got = requireValues(parameters, ['voutFixed'] as const);
      if (!got.ok) {
        return missingParameters(got.missing);
      }
      // A null fixed output is the schema's way of saying the part is
      // adjustable, not that the datasheet was silent.
      return {
        kind: 'classified',
        classification: {
          axis: 'outputType',
          value: got.values.voutFixed === null ? 'adjustable' : 'fixed',
          derivedFrom: ['voutFixed'],
          rule: 'output-type.v1',
        },
      };
    },
  },
  {
    axis: 'packageFamily',
    id: 'package-family.v1',
    needs: ['package'],
    apply: (parameters) => {
      const got = requireValues(parameters, ['package'] as const);
      if (!got.ok) {
        return missingParameters(got.missing);
      }
      const shape = parsePackage(got.values.package);
      if (shape.family === null) {
        // `other` is a shape outside the vocabulary, so it cannot double as
        // "unreadable" without making the two indistinguishable downstream.
        return undecidedBecause(`"${got.values.package}" names no package family`);
      }
      return {
        kind: 'classified',
        classification: {
          axis: 'packageFamily',
          value: shape.family,
          derivedFrom: ['package'],
          rule: 'package-family.v1',
        },
      };
    },
  },
  {
    axis: 'temperatureGrade',
    id: 'temperature-grade.v1',
    needs: ['operatingTempMin', 'operatingTempMax', 'aecQ100'],
    apply: (parameters) => {
      const got = requireValues(parameters, [
        'operatingTempMin',
        'operatingTempMax',
        'aecQ100',
      ] as const);
      if (!got.ok) {
        return missingParameters(got.missing);
      }
      const derivedFrom: ParameterKey[] = ['operatingTempMin', 'operatingTempMax', 'aecQ100'];
      if (got.values.aecQ100) {
        return {
          kind: 'classified',
          classification: {
            axis: 'temperatureGrade',
            value: 'automotive',
            derivedFrom,
            rule: 'temperature-grade.v1',
          },
        };
      }
      const min = got.values.operatingTempMin.value;
      const max = got.values.operatingTempMax.value;
      for (const [low, high, grade] of TEMPERATURE_ENVELOPES) {
        if (min <= low && max >= high) {
          return {
            kind: 'classified',
            classification: {
              axis: 'temperatureGrade',
              value: grade,
              derivedFrom,
              rule: 'temperature-grade.v1',
            },
          };
        }
      }
      return undecidedBecause(
        `${String(min)} °C to ${String(max)} °C covers no grade's full range`,
      );
    },
  },
  {
    axis: 'features',
    id: 'features.v1',
    needs: ['enablePin', 'powerGoodPin', 'softStart', 'externalSync', 'lightLoadMode'],
    apply: (parameters) => {
      const keys = [
        'enablePin',
        'powerGoodPin',
        'softStart',
        'externalSync',
        'lightLoadMode',
      ] as const;
      const got = requireValues(parameters, keys);
      if (!got.ok) {
        return missingParameters(got.missing);
      }
      const present: ('enable' | 'power_good' | 'soft_start' | 'sync' | 'light_load')[] = [];
      if (got.values.enablePin) {
        present.push('enable');
      }
      if (got.values.powerGoodPin) {
        present.push('power_good');
      }
      if (got.values.softStart.present) {
        present.push('soft_start');
      }
      if (got.values.externalSync) {
        present.push('sync');
      }
      if (LIGHT_LOAD_MODES.has(got.values.lightLoadMode)) {
        present.push('light_load');
      }
      return {
        kind: 'classified',
        classification: {
          axis: 'features',
          value: present,
          derivedFrom: [...keys],
          rule: 'features.v1',
        },
      };
    },
  },
]);
