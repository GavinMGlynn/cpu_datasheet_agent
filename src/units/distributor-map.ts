import type { ObservedValue } from '../core/observation.js';
import type { ParameterKey } from '../core/parameter-keys.js';
import type { Quantity, Unit } from '../core/quantity.js';
import { normaliseText } from './normalise.js';
import {
  ParseError,
  parseQuantity,
  parseRange,
  parseTemperatureRange,
  splitRange,
  type ParseResult,
} from './parse.js';

export type MappingKind =
  | 'quantity'
  | 'quantity_or_range'
  | 'output_voltage'
  | 'temperature_range'
  | 'synchronous_yes_no'
  | 'output_type'
  | 'control_features'
  | 'text';

export interface DistributorMapping {
  /** Parameter keys the attribute can inform. */
  readonly keys: readonly ParameterKey[];
  readonly kind: MappingKind;
  readonly unit?: Unit;
}

/**
 * One value learned from a distributor attribute: an {@link ObservedValue}
 * plus the parameter key it informs. Provenance is added by the adapter.
 *
 * Sharing the shape with the core schema is deliberate. A fact that turns out
 * to disagree with the datasheet is stored on the parameter as it was
 * observed, so nothing is reshaped between reading it and recording it.
 */
export type DistributorFact = ObservedValue & { readonly key: ParameterKey };

const TEMPERATURE: DistributorMapping = {
  keys: ['operatingTempMin', 'operatingTempMax', 'temperatureReference'],
  kind: 'temperature_range',
};
const SYNCHRONOUS: DistributorMapping = { keys: ['topology'], kind: 'synchronous_yes_no' };
const OUTPUT_TYPE: DistributorMapping = { keys: ['voutFixed'], kind: 'output_type' };
const PACKAGE: DistributorMapping = { keys: ['package'], kind: 'text' };

/**
 * Digi-Key parametric names for the DC-DC switching regulator category.
 * Extended as recorded fixtures reveal further names (Module 7).
 */
export const DIGIKEY_PARAMETER_MAP: Readonly<Record<string, DistributorMapping>> = Object.freeze({
  'Voltage - Input (Min)': { keys: ['vinMin'], kind: 'quantity', unit: 'V' },
  'Voltage - Input (Max)': { keys: ['vinMax'], kind: 'quantity', unit: 'V' },
  'Voltage - Output (Min/Fixed)': { keys: ['voutMin'], kind: 'quantity', unit: 'V' },
  'Voltage - Output (Max)': { keys: ['voutMax'], kind: 'quantity', unit: 'V' },
  'Current - Output': { keys: ['ioutMax'], kind: 'quantity', unit: 'A' },
  'Current - Quiescent (Iq)': { keys: ['quiescentCurrent'], kind: 'quantity', unit: 'A' },
  'Frequency - Switching': { keys: ['switchingFrequency'], kind: 'quantity_or_range', unit: 'Hz' },
  'Synchronous Rectifier': SYNCHRONOUS,
  'Output Type': OUTPUT_TYPE,
  'Operating Temperature': TEMPERATURE,
  'Package / Case': PACKAGE,
  'Supplier Device Package': PACKAGE,
  'Control Features': {
    keys: ['enablePin', 'powerGoodPin', 'softStart', 'externalSync'],
    kind: 'control_features',
  },
});

/** Mouser attribute names for switching regulators. Extended from fixtures in Module 8. */
export const MOUSER_ATTRIBUTE_MAP: Readonly<Record<string, DistributorMapping>> = Object.freeze({
  'Input Voltage MIN': { keys: ['vinMin'], kind: 'quantity', unit: 'V' },
  'Input Voltage MAX': { keys: ['vinMax'], kind: 'quantity', unit: 'V' },
  'Output Voltage': {
    keys: ['voutMin', 'voutMax', 'voutFixed'],
    kind: 'output_voltage',
    unit: 'V',
  },
  'Output Current': { keys: ['ioutMax'], kind: 'quantity', unit: 'A' },
  'Quiescent Current': { keys: ['quiescentCurrent'], kind: 'quantity', unit: 'A' },
  'Switching Frequency': { keys: ['switchingFrequency'], kind: 'quantity_or_range', unit: 'Hz' },
  'Minimum Operating Temperature': { keys: ['operatingTempMin'], kind: 'quantity', unit: 'degC' },
  'Maximum Operating Temperature': { keys: ['operatingTempMax'], kind: 'quantity', unit: 'degC' },
  'Operating Temperature Range': TEMPERATURE,
  'Synchronous Rectifier': SYNCHRONOUS,
  'Output Type': OUTPUT_TYPE,
  'Package / Case': PACKAGE,
});

function canonicalName(name: string): string {
  return normaliseText(name).toLowerCase();
}

function lookup(
  table: Readonly<Record<string, DistributorMapping>>,
  name: string,
): DistributorMapping | null {
  const wanted = canonicalName(name);
  for (const [key, mapping] of Object.entries(table)) {
    if (canonicalName(key) === wanted) {
      return mapping;
    }
  }
  return null;
}

/** Mapping for a Digi-Key parameter name, or null when the name carries no schema parameter. */
export function digikeyParameterToKey(name: string): DistributorMapping | null {
  return lookup(DIGIKEY_PARAMETER_MAP, name);
}

/** Mapping for a Mouser attribute name, or null when the name carries no schema parameter. */
export function mouserAttributeToKey(name: string): DistributorMapping | null {
  return lookup(MOUSER_ATTRIBUTE_MAP, name);
}

const NOT_APPLICABLE: ReadonlySet<string> = new Set(['', '-', 'n/a', 'na', 'not applicable']);

/** Phrases that state a bound rather than a value. */
const UPPER_BOUND = /^(?:up\s+to|max(?:imum)?(?:\s+of)?|≤|<=|<)\s*/i;
const LOWER_BOUND = /^(?:down\s+to|from|min(?:imum)?(?:\s+of)?|≥|>=|>)\s*/i;

interface Qualified {
  readonly kind: 'quantity' | 'max' | 'min';
  readonly text: string;
}

/** Splits a leading bound phrase from the value it qualifies. */
export function splitQualifier(text: string): Qualified {
  if (UPPER_BOUND.test(text)) {
    return { kind: 'max', text: text.replace(UPPER_BOUND, '') };
  }
  if (LOWER_BOUND.test(text)) {
    return { kind: 'min', text: text.replace(LOWER_BOUND, '') };
  }
  return { kind: 'quantity', text };
}

const FEATURE_KEYS: readonly (readonly [RegExp, ParameterKey])[] = [
  [/\benable\b/, 'enablePin'],
  [/\bpower[- ]?good\b/, 'powerGoodPin'],
  [/\bsoft[- ]?start\b/, 'softStart'],
  [/\b(sync|synchronizable|synchronisable|frequency sync)\b/, 'externalSync'],
];

function unit(mapping: DistributorMapping, text: string): Unit {
  if (mapping.unit === undefined) {
    throw new ParseError('UNIT_PARSE_FAILED', `mapping for ${mapping.keys.join(',')} has no unit`, {
      details: { text, reason: 'mapping has no unit' },
    });
  }
  return mapping.unit;
}

function quantity(key: ParameterKey, value: Quantity): DistributorFact {
  return { kind: 'quantity', key, value };
}

/**
 * Turns a distributor attribute value into schema-keyed facts using its
 * mapping. `-`, blank, and `N/A` yield no facts. Throws {@link ParseError}
 * for text the mapping cannot interpret.
 */
export function parseDistributorValue(
  mapping: DistributorMapping,
  rawText: string,
): readonly DistributorFact[] {
  const text = normaliseText(rawText);
  if (NOT_APPLICABLE.has(text.toLowerCase())) {
    return [];
  }
  const key = mapping.keys[0];
  if (key === undefined) {
    throw new ParseError('UNIT_PARSE_FAILED', `cannot parse "${text}": mapping has no keys`, {
      details: { text, reason: 'mapping has no keys' },
    });
  }
  switch (mapping.kind) {
    case 'quantity': {
      const qualified = splitQualifier(text);
      return [
        { kind: qualified.kind, key, value: parseQuantity(qualified.text, unit(mapping, text)) },
      ];
    }
    case 'quantity_or_range': {
      const target = unit(mapping, text);
      // The qualifier is checked first: `to` is also a range separator, so
      // "Up to 1MHz" would otherwise split into a range with "Up" as its min.
      const qualified = splitQualifier(text);
      if (qualified.kind !== 'quantity') {
        return [{ kind: qualified.kind, key, value: parseQuantity(qualified.text, target) }];
      }
      if (splitRange(text).length === 2) {
        return [{ kind: 'range', key, value: parseRange(text, target) }];
      }
      return [{ kind: 'quantity', key, value: parseQuantity(text, target) }];
    }
    case 'output_voltage': {
      const target = unit(mapping, text);
      if (splitRange(text).length === 2) {
        const range = parseRange(text, target);
        return [
          quantity('voutMin', { value: range.min, unit: target }),
          quantity('voutMax', { value: range.max, unit: target }),
          { kind: 'enum', key: 'voutFixed', value: 'adjustable' },
        ];
      }
      const fixed = parseQuantity(text, target);
      return [quantity('voutFixed', fixed), quantity('voutMin', fixed), quantity('voutMax', fixed)];
    }
    case 'temperature_range': {
      const { range, reference } = parseTemperatureRange(text);
      const facts: DistributorFact[] = [
        quantity('operatingTempMin', { value: range.min, unit: 'degC' }),
        quantity('operatingTempMax', { value: range.max, unit: 'degC' }),
      ];
      if (reference !== null) {
        facts.push({ kind: 'enum', key: 'temperatureReference', value: reference });
      }
      return facts;
    }
    case 'synchronous_yes_no': {
      const word = text.toLowerCase();
      if (word === 'yes') {
        return [{ kind: 'enum', key: 'topology', value: 'synchronous' }];
      }
      if (word === 'no') {
        return [{ kind: 'enum', key: 'topology', value: 'non_synchronous' }];
      }
      if (word === 'both') {
        // Digi-Key writes "Both" for a part that can run either way. It
        // corroborates nothing, and the datasheet decides topology, so it
        // yields no fact rather than a guess or a spurious parse failure.
        return [];
      }
      throw new ParseError(
        'UNIT_PARSE_FAILED',
        `cannot parse "${text}": expected Yes, No, or Both`,
        {
          details: { text, reason: 'expected Yes, No, or Both' },
        },
      );
    }
    case 'output_type': {
      const word = text.toLowerCase();
      if (word === 'fixed' || word === 'adjustable') {
        return [{ kind: 'enum', key: 'voutFixed', value: word }];
      }
      if (/^fixed\s*,\s*adjustable$|^adjustable\s*,\s*fixed$/.test(word)) {
        // A listing offering both. Inconclusive for the same reason as "Both".
        return [];
      }
      throw new ParseError(
        'UNIT_PARSE_FAILED',
        `cannot parse "${text}": expected Fixed or Adjustable`,
        {
          details: { text, reason: 'expected Fixed or Adjustable' },
        },
      );
    }
    case 'control_features': {
      const listed = text.toLowerCase();
      // Only the features the list names are claimed. A feature the list does
      // not mention is not a part without it: the list is a short description,
      // not an inventory, and a false here would contradict the datasheet's
      // own reading of a part that has the feature.
      return FEATURE_KEYS.filter(([pattern]) => pattern.test(listed)).map(([, featureKey]) => ({
        kind: 'boolean',
        key: featureKey,
        value: true,
      }));
    }
    case 'text':
      return [{ kind: 'text', key, value: text }];
  }
}

/**
 * {@link parseDistributorValue} as a result rather than an exception, so a
 * caller collecting failures across many attributes needs no try/catch.
 * Anything that is not a {@link ParseError} is a bug and still propagates.
 */
export function tryParseDistributorValue(
  mapping: DistributorMapping,
  rawText: string,
): ParseResult<readonly DistributorFact[]> {
  try {
    return { ok: true, value: parseDistributorValue(mapping, rawText) };
  } catch (error) {
    if (error instanceof ParseError) {
      return { ok: false, error };
    }
    throw error;
  }
}
