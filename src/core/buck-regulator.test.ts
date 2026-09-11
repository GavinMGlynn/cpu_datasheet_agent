import { describe, expect, it } from 'vitest';

import { buckParameters, param, q } from '../../test/helpers/core-fixtures.js';
import { expectAccepts, expectRejects } from '../../test/helpers/schema.js';
import {
  BUCK_REGULATOR_SHAPE,
  BuckRegulatorParameters,
  INTEGRATIONS,
  Integration,
  LIGHT_LOAD_MODES,
  LightLoadMode,
  PartialBuckRegulatorParameters,
  SoftStart,
  TEMPERATURE_REFERENCES,
  TOPOLOGIES,
  TemperatureReference,
  Topology,
} from './buck-regulator.js';
import { PARAMETER_KEYS } from './parameter-keys.js';

describe('enums', () => {
  it.each(TOPOLOGIES)('Topology accepts %s', (value) => {
    expectAccepts(Topology, value);
  });
  it.each(INTEGRATIONS)('Integration accepts %s', (value) => {
    expectAccepts(Integration, value);
  });
  it.each(LIGHT_LOAD_MODES)('LightLoadMode accepts %s', (value) => {
    expectAccepts(LightLoadMode, value);
  });
  it.each(TEMPERATURE_REFERENCES)('TemperatureReference accepts %s', (value) => {
    expectAccepts(TemperatureReference, value);
  });
  it('rejects values outside each enum', () => {
    expectRejects(Topology, 'sync');
    expectRejects(Integration, 'module');
    expectRejects(LightLoadMode, 'burst');
    expectRejects(TemperatureReference, 'case');
  });
});

describe('SoftStart', () => {
  it('accepts present with or without a time, and absent without a time', () => {
    expectAccepts(SoftStart, { present: true, time: null });
    expectAccepts(SoftStart, { present: true, time: { value: 0.002, unit: 's' } });
    expectAccepts(SoftStart, { present: false, time: null });
  });

  it('rejects a time on a part without soft start', () => {
    expectRejects(SoftStart, { present: false, time: { value: 0.002, unit: 's' } }, 'time');
  });

  it('rejects a time in the wrong unit or a missing time key', () => {
    expectRejects(SoftStart, { present: true, time: { value: 2, unit: 'V' } }, 'time');
    expectRejects(SoftStart, { present: true });
  });
});

describe('BuckRegulatorParameters', () => {
  it('has exactly the keys listed in PARAMETER_KEYS, in order', () => {
    expect(Object.keys(BuckRegulatorParameters.shape)).toEqual([...PARAMETER_KEYS]);
  });

  it('accepts the fixture part unchanged', () => {
    expectAccepts(BuckRegulatorParameters, buckParameters());
  });

  it('accepts a synchronous integrated part with both FET resistances', () => {
    expectAccepts(
      BuckRegulatorParameters,
      buckParameters({
        topology: param('synchronous'),
        rdsOnHigh: param(q(0.06, 'Ohm')),
        rdsOnLow: param(q(0.03, 'Ohm')),
      }),
    );
  });

  it('accepts a controller with no FET resistances', () => {
    expectAccepts(
      BuckRegulatorParameters,
      buckParameters({
        topology: param('synchronous'),
        integration: param('controller'),
        rdsOnHigh: param(null),
        rdsOnLow: param(null),
      }),
    );
  });

  it('accepts a fixed-output part whose voutMin and voutMax equal voutFixed', () => {
    expectAccepts(
      BuckRegulatorParameters,
      buckParameters({
        voutFixed: param(q(3.3, 'V')),
        voutMin: param(q(3.3, 'V')),
        voutMax: param(q(3.3, 'V')),
      }),
    );
  });

  it('accepts an adjustable switching frequency range', () => {
    expectAccepts(
      BuckRegulatorParameters,
      buckParameters({ switchingFrequency: param({ unit: 'Hz', min: 200000, max: 2200000 }) }),
    );
  });

  it('rejects the CLAUDE.md case: a range written as text where a quantity is expected', () => {
    expectRejects(
      BuckRegulatorParameters,
      buckParameters({ vinMin: param('3 V to 32 V') }),
      'vinMin.value',
    );
  });

  it('rejects a missing parameter and an unknown one', () => {
    const { aecQ100: _aec, ...missing } = buckParameters();
    expectRejects(BuckRegulatorParameters, missing, 'aecQ100');
    expectRejects(BuckRegulatorParameters, buckParameters({ colour: param('black') }));
  });

  it('rejects a parameter whose provenance lacks a page', () => {
    expectRejects(
      BuckRegulatorParameters,
      buckParameters({
        ioutMax: {
          value: q(3, 'A'),
          provenance: { source: 'datasheet', sha256: 'a'.repeat(64), method: 'text' },
          confidence: 'extracted',
        },
      }),
      'ioutMax.provenance.page',
    );
  });

  describe('cross-field invariants', () => {
    it('rejects vinMin equal to or above vinMax', () => {
      expectRejects(
        BuckRegulatorParameters,
        buckParameters({ vinMin: param(q(28, 'V')) }),
        'vinMax.value.value',
      );
      expectRejects(
        BuckRegulatorParameters,
        buckParameters({ vinMin: param(q(29, 'V')) }),
        'vinMax.value.value',
      );
    });

    it('rejects vinMax above vinAbsMax but allows equality', () => {
      expectRejects(
        BuckRegulatorParameters,
        buckParameters({ vinAbsMax: param(q(27, 'V')) }),
        'vinAbsMax.value.value',
      );
      expectAccepts(BuckRegulatorParameters, buckParameters({ vinAbsMax: param(q(28, 'V')) }));
    });

    it('rejects voutMin above voutMax but allows equality', () => {
      expectRejects(
        BuckRegulatorParameters,
        buckParameters({ voutMin: param(q(26, 'V')) }),
        'voutMax.value.value',
      );
      expectAccepts(BuckRegulatorParameters, buckParameters({ voutMin: param(q(25, 'V')) }));
    });

    it('rejects a fixed output that disagrees with voutMin or voutMax', () => {
      expectRejects(
        BuckRegulatorParameters,
        buckParameters({
          voutFixed: param(q(3.3, 'V')),
          voutMin: param(q(3.3, 'V')),
          voutMax: param(q(5, 'V')),
        }),
        'voutFixed.value.value',
      );
      expectRejects(
        BuckRegulatorParameters,
        buckParameters({
          voutFixed: param(q(3.3, 'V')),
          voutMin: param(q(1, 'V')),
          voutMax: param(q(3.3, 'V')),
        }),
        'voutFixed.value.value',
      );
    });

    it('rejects operatingTempMin equal to or above operatingTempMax', () => {
      expectRejects(
        BuckRegulatorParameters,
        buckParameters({ operatingTempMin: param(q(150, 'degC')) }),
        'operatingTempMax.value.value',
      );
    });

    it('rejects a low-side resistance on a non-synchronous part', () => {
      expectRejects(
        BuckRegulatorParameters,
        buckParameters({ rdsOnLow: param(q(0.03, 'Ohm')) }),
        'rdsOnLow.value',
      );
    });

    it('rejects FET resistances on a controller', () => {
      expectRejects(
        BuckRegulatorParameters,
        buckParameters({ integration: param('controller'), rdsOnLow: param(null) }),
        'rdsOnHigh.value',
      );
      expectRejects(
        BuckRegulatorParameters,
        buckParameters({
          integration: param('controller'),
          topology: param('synchronous'),
          rdsOnHigh: param(null),
          rdsOnLow: param(q(0.03, 'Ohm')),
        }),
        'rdsOnLow.value',
      );
    });

    it('rejects a time on a part without soft start, through the parameter path', () => {
      expectRejects(
        BuckRegulatorParameters,
        buckParameters({ softStart: param({ present: false, time: q(0.001, 's') }) }),
        'softStart.value.time',
      );
    });
  });

  describe('unit pinning', () => {
    it.each([
      ['vinMin', q(5, 'A')],
      ['ioutMax', q(3, 'V')],
      ['switchingFrequency', q(570000, 'V')],
      ['quiescentCurrent', q(70, 'count')],
      ['operatingTempMin', q(-40, 'V')],
      ['minOnTime', q(130, 'Hz')],
      ['maxDutyCycle', q(91, 'V')],
      ['rdsOnHigh', q(80, 'W')],
    ])('rejects %s in the wrong unit', (key, value) => {
      expectRejects(
        BuckRegulatorParameters,
        buckParameters({ [key]: param(value) }),
        `${key}.value`,
      );
    });

    it('rejects an operating temperature below absolute zero', () => {
      expectRejects(
        BuckRegulatorParameters,
        buckParameters({ operatingTempMin: param(q(-300, 'degC')) }),
        'operatingTempMin',
      );
    });

    it('rejects a range where a single frequency is fine, but not a range in another unit', () => {
      expectRejects(
        BuckRegulatorParameters,
        buckParameters({ switchingFrequency: param({ unit: 'V', min: 1, max: 2 }) }),
        'switchingFrequency.value',
      );
    });
  });

  describe('nullability', () => {
    it.each([
      'vinMin',
      'vinMax',
      'ioutMax',
      'quiescentCurrent',
      'package',
      'topology',
      'enablePin',
      'aecQ100',
    ])('rejects null for required parameter %s', (key) => {
      expectRejects(
        BuckRegulatorParameters,
        buckParameters({ [key]: param(null) }),
        `${key}.value`,
      );
    });

    it.each([
      'voutFixed',
      'feedbackReference',
      'feedbackAccuracy',
      'shutdownCurrent',
      'minOnTime',
      'maxDutyCycle',
      'efficiencyPeak',
      'rdsOnHigh',
    ])('accepts null for optional parameter %s', (key) => {
      expectAccepts(BuckRegulatorParameters, buckParameters({ [key]: param(null) }));
    });
  });
});

describe('PartialBuckRegulatorParameters', () => {
  it('accepts an empty set and any subset, each parameter still shape-checked', () => {
    expectAccepts(PartialBuckRegulatorParameters, {});
    expectAccepts(PartialBuckRegulatorParameters, { vinMax: param(q(28, 'V')) });
    // The CLAUDE.md case: a string where a quantity belongs is still rejected.
    expectRejects(PartialBuckRegulatorParameters, { vinMax: param('3 V to 32 V') }, 'vinMax');
    expectRejects(PartialBuckRegulatorParameters, { nope: param(q(1, 'V')) });
  });

  it('drops the cross-field checks, which upsert_part still applies', () => {
    // vinMax below vinMin: absurd as a whole part, unremarkable as a fragment
    // of one being built.
    expectAccepts(PartialBuckRegulatorParameters, {
      vinMin: param(q(28, 'V')),
      vinMax: param(q(3, 'V')),
    });
  });

  it('is built from the same shape as the full schema', () => {
    expect(Object.keys(BUCK_REGULATOR_SHAPE).sort()).toEqual([...PARAMETER_KEYS].sort());
    expect(Object.isFrozen(BUCK_REGULATOR_SHAPE)).toBe(true);
  });
});
