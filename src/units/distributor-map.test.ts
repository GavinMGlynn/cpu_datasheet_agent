import { describe, expect, it } from 'vitest';

import { PARAMETER_KEYS } from '../core/parameter-keys.js';
import {
  DIGIKEY_PARAMETER_MAP,
  MOUSER_ATTRIBUTE_MAP,
  digikeyParameterToKey,
  mouserAttributeToKey,
  parseDistributorValue,
  splitQualifier,
  tryParseDistributorValue,
  type DistributorMapping,
} from './distributor-map.js';
import { ParseError } from './parse.js';

describe('mapping tables', () => {
  it.each(Object.entries(DIGIKEY_PARAMETER_MAP))(
    'Digi-Key "%s" maps to schema keys',
    (name, mapping) => {
      expect(digikeyParameterToKey(name)).toBe(mapping);
      for (const key of mapping.keys) {
        expect(PARAMETER_KEYS).toContain(key);
      }
    },
  );

  it.each(Object.entries(MOUSER_ATTRIBUTE_MAP))(
    'Mouser "%s" maps to schema keys',
    (name, mapping) => {
      expect(mouserAttributeToKey(name)).toBe(mapping);
      for (const key of mapping.keys) {
        expect(PARAMETER_KEYS).toContain(key);
      }
    },
  );

  it('matches names regardless of case and spacing', () => {
    expect(digikeyParameterToKey('  voltage - input (min) ')).toBe(
      DIGIKEY_PARAMETER_MAP['Voltage - Input (Min)'],
    );
    expect(mouserAttributeToKey('OUTPUT   CURRENT')).toBe(MOUSER_ATTRIBUTE_MAP['Output Current']);
  });

  it.each([
    'Number of Outputs',
    'Topology',
    'Function',
    'Mounting Type',
    'Series',
    'Packaging',
    'Product Category',
    '',
  ])('returns null for %j', (name) => {
    expect(digikeyParameterToKey(name)).toBeNull();
    expect(mouserAttributeToKey(name)).toBeNull();
  });
});

describe('parseDistributorValue', () => {
  const must = (mapping: DistributorMapping | null): DistributorMapping => {
    if (mapping === null) {
      throw new Error('expected a mapping');
    }
    return mapping;
  };
  const dk = (name: string): DistributorMapping => must(digikeyParameterToKey(name));
  const mouser = (name: string): DistributorMapping => must(mouserAttributeToKey(name));

  it.each(['-', '', '  ', 'N/A', 'n/a', 'NA', 'Not Applicable'])(
    'yields nothing for %j',
    (text) => {
      expect(parseDistributorValue(dk('Voltage - Input (Min)'), text)).toEqual([]);
    },
  );

  it('parses plain quantities', () => {
    expect(parseDistributorValue(dk('Voltage - Input (Min)'), '4.5V')).toEqual([
      { kind: 'quantity', key: 'vinMin', value: { value: 4.5, unit: 'V' } },
    ]);
    expect(parseDistributorValue(dk('Current - Output'), '3A')).toEqual([
      { kind: 'quantity', key: 'ioutMax', value: { value: 3, unit: 'A' } },
    ]);
    expect(parseDistributorValue(mouser('Minimum Operating Temperature'), '- 40 C')).toEqual([
      { kind: 'quantity', key: 'operatingTempMin', value: { value: -40, unit: 'degC' } },
    ]);
    expect(parseDistributorValue(dk('Current - Quiescent (Iq)'), '70µA')).toEqual([
      { kind: 'quantity', key: 'quiescentCurrent', value: { value: 0.00007, unit: 'A' } },
    ]);
  });

  it('parses a frequency as a quantity or a range', () => {
    expect(parseDistributorValue(dk('Frequency - Switching'), '570kHz')).toEqual([
      { kind: 'quantity', key: 'switchingFrequency', value: { value: 570000, unit: 'Hz' } },
    ]);
    expect(parseDistributorValue(mouser('Switching Frequency'), '100 kHz to 1.5 MHz')).toEqual([
      {
        kind: 'range',
        key: 'switchingFrequency',
        value: { unit: 'Hz', min: 100000, max: 1500000 },
      },
    ]);
  });

  it('parses an output voltage as fixed or adjustable', () => {
    expect(parseDistributorValue(mouser('Output Voltage'), '0.8 V to 25 V')).toEqual([
      { kind: 'quantity', key: 'voutMin', value: { value: 0.8, unit: 'V' } },
      { kind: 'quantity', key: 'voutMax', value: { value: 25, unit: 'V' } },
      { kind: 'enum', key: 'voutFixed', value: 'adjustable' },
    ]);
    expect(parseDistributorValue(mouser('Output Voltage'), '3.3 V')).toEqual([
      { kind: 'quantity', key: 'voutFixed', value: { value: 3.3, unit: 'V' } },
      { kind: 'quantity', key: 'voutMin', value: { value: 3.3, unit: 'V' } },
      { kind: 'quantity', key: 'voutMax', value: { value: 3.3, unit: 'V' } },
    ]);
  });

  it('parses a temperature range with and without a reference marker', () => {
    expect(parseDistributorValue(dk('Operating Temperature'), '-40°C ~ 125°C (TJ)')).toEqual([
      { kind: 'quantity', key: 'operatingTempMin', value: { value: -40, unit: 'degC' } },
      { kind: 'quantity', key: 'operatingTempMax', value: { value: 125, unit: 'degC' } },
      { kind: 'enum', key: 'temperatureReference', value: 'junction' },
    ]);
    expect(parseDistributorValue(mouser('Operating Temperature Range'), '-40 C to +85 C')).toEqual([
      { kind: 'quantity', key: 'operatingTempMin', value: { value: -40, unit: 'degC' } },
      { kind: 'quantity', key: 'operatingTempMax', value: { value: 85, unit: 'degC' } },
    ]);
  });

  it('parses the synchronous rectifier flag', () => {
    expect(parseDistributorValue(dk('Synchronous Rectifier'), 'Yes')).toEqual([
      { kind: 'enum', key: 'topology', value: 'synchronous' },
    ]);
    expect(parseDistributorValue(dk('Synchronous Rectifier'), 'no')).toEqual([
      { kind: 'enum', key: 'topology', value: 'non_synchronous' },
    ]);
    expect(() => parseDistributorValue(dk('Synchronous Rectifier'), 'Maybe')).toThrow(ParseError);
  });

  it('yields no topology fact when Digi-Key says the part does both', () => {
    expect(parseDistributorValue(dk('Synchronous Rectifier'), 'Both')).toEqual([]);
    expect(parseDistributorValue(dk('Synchronous Rectifier'), 'both')).toEqual([]);
  });

  it('yields no output-type fact when a listing offers both', () => {
    expect(parseDistributorValue(dk('Output Type'), 'Fixed, Adjustable')).toEqual([]);
    expect(parseDistributorValue(dk('Output Type'), 'Adjustable, Fixed')).toEqual([]);
  });

  it('parses the output type', () => {
    expect(parseDistributorValue(dk('Output Type'), 'Fixed')).toEqual([
      { kind: 'enum', key: 'voutFixed', value: 'fixed' },
    ]);
    expect(parseDistributorValue(dk('Output Type'), 'ADJUSTABLE')).toEqual([
      { kind: 'enum', key: 'voutFixed', value: 'adjustable' },
    ]);
    expect(() => parseDistributorValue(dk('Output Type'), 'Switchable')).toThrow(ParseError);
  });

  it('claims only the control features the list names', () => {
    expect(
      parseDistributorValue(dk('Control Features'), 'Enable, Power Good, Soft-Start, Sync'),
    ).toEqual([
      { kind: 'boolean', key: 'enablePin', value: true },
      { kind: 'boolean', key: 'powerGoodPin', value: true },
      { kind: 'boolean', key: 'softStart', value: true },
      { kind: 'boolean', key: 'externalSync', value: true },
    ]);
    // A feature the list does not mention yields nothing rather than a false:
    // the list is a description, not an inventory of what the part lacks.
    expect(parseDistributorValue(dk('Control Features'), 'Enable')).toEqual([
      { kind: 'boolean', key: 'enablePin', value: true },
    ]);
    expect(
      parseDistributorValue(
        dk('Control Features'),
        'Frequency Control, Synchronizable, Soft Start',
      ),
    ).toEqual([
      { kind: 'boolean', key: 'softStart', value: true },
      { kind: 'boolean', key: 'externalSync', value: true },
    ]);
    expect(parseDistributorValue(dk('Control Features'), 'Frequency Control')).toEqual([]);
  });

  it('passes package text through', () => {
    expect(parseDistributorValue(dk('Package / Case'), '8-SOIC (0.154", 3.90mm Width)')).toEqual([
      { kind: 'text', key: 'package', value: '8-SOIC (0.154", 3.90mm Width)' },
    ]);
  });

  it('rejects text the mapping cannot interpret', () => {
    expect(() => parseDistributorValue(dk('Voltage - Input (Min)'), '4.5 to 28 V')).toThrow(
      ParseError,
    );
    expect(() => parseDistributorValue(dk('Current - Output'), 'lots')).toThrow(ParseError);
  });

  it('rejects a quantity mapping that has no unit', () => {
    const broken: DistributorMapping = { keys: ['vinMin'], kind: 'quantity' };
    expect(() => parseDistributorValue(broken, '4.5V')).toThrow(ParseError);
    const brokenRange: DistributorMapping = {
      keys: ['switchingFrequency'],
      kind: 'quantity_or_range',
    };
    expect(() => parseDistributorValue(brokenRange, '1 to 2 kHz')).toThrow(ParseError);
    const brokenOutput: DistributorMapping = { keys: ['voutFixed'], kind: 'output_voltage' };
    expect(() => parseDistributorValue(brokenOutput, '3.3 V')).toThrow(ParseError);
  });
});

describe('parseDistributorValue with a keyless mapping', () => {
  it('rejects it', () => {
    expect(() => parseDistributorValue({ keys: [], kind: 'text' }, 'x')).toThrow(ParseError);
  });
});

describe('stated bounds', () => {
  const must = (mapping: DistributorMapping | null): DistributorMapping => {
    if (mapping === null) {
      throw new Error('expected a mapping');
    }
    return mapping;
  };

  it.each([
    ['Up to 1MHz', 'max'],
    ['up to 1MHz', 'max'],
    ['max 1MHz', 'max'],
    ['maximum of 1MHz', 'max'],
    ['<= 1MHz', 'max'],
    ['≤1MHz', 'max'],
    ['from 1MHz', 'min'],
    ['min 1MHz', 'min'],
    ['down to 1MHz', 'min'],
    ['>= 1MHz', 'min'],
    ['≥1MHz', 'min'],
  ])('reads %j as a stated %s', (text, kind) => {
    expect(
      parseDistributorValue(must(digikeyParameterToKey('Frequency - Switching')), text),
    ).toEqual([{ kind, key: 'switchingFrequency', value: { value: 1_000_000, unit: 'Hz' } }]);
  });

  it('still reads a plain value as a quantity and a pair as a range', () => {
    const mapping = must(digikeyParameterToKey('Frequency - Switching'));

    expect(parseDistributorValue(mapping, '570kHz')).toEqual([
      { kind: 'quantity', key: 'switchingFrequency', value: { value: 570_000, unit: 'Hz' } },
    ]);
    expect(parseDistributorValue(mapping, '100kHz to 1MHz')).toEqual([
      {
        kind: 'range',
        key: 'switchingFrequency',
        value: { unit: 'Hz', min: 100_000, max: 1_000_000 },
      },
    ]);
  });

  it('applies to plain quantity mappings too', () => {
    expect(
      parseDistributorValue(must(digikeyParameterToKey('Current - Output')), 'up to 3A'),
    ).toEqual([{ kind: 'max', key: 'ioutMax', value: { value: 3, unit: 'A' } }]);
  });

  it('splits the qualifier from the value', () => {
    expect(splitQualifier('Up to 1MHz')).toEqual({ kind: 'max', text: '1MHz' });
    expect(splitQualifier('570kHz')).toEqual({ kind: 'quantity', text: '570kHz' });
    expect(splitQualifier('minimum 2V')).toEqual({ kind: 'min', text: '2V' });
  });
});

describe('tryParseDistributorValue', () => {
  const found = digikeyParameterToKey('Voltage - Input (Min)');
  if (found === null) {
    throw new Error('expected a mapping for Voltage - Input (Min)');
  }
  const mapping: DistributorMapping = found;

  it('returns the facts when the value parses', () => {
    expect(tryParseDistributorValue(mapping, '4.5V')).toEqual({
      ok: true,
      value: [{ kind: 'quantity', key: 'vinMin', value: { value: 4.5, unit: 'V' } }],
    });
  });

  it('returns the parse error rather than throwing', () => {
    const result = tryParseDistributorValue(mapping, 'about five volts');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ParseError);
      expect(result.error.code).toBe('UNIT_PARSE_FAILED');
    }
  });

  it('rethrows anything that is not a parse error', () => {
    expect(() => tryParseDistributorValue(mapping, 5 as unknown as string)).toThrow(TypeError);
  });
});
