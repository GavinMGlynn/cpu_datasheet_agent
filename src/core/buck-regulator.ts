import { z } from 'zod';

import { parameter } from './parameter.js';
import { Celsius } from './primitives.js';
import { quantityOf, rangeOf } from './quantity.js';

export const TOPOLOGIES = ['synchronous', 'non_synchronous'] as const;
export const Topology = z.enum(TOPOLOGIES);
export type Topology = z.output<typeof Topology>;

export const INTEGRATIONS = ['integrated_fet', 'controller'] as const;
export const Integration = z.enum(INTEGRATIONS);
export type Integration = z.output<typeof Integration>;

export const LIGHT_LOAD_MODES = ['pfm', 'psm', 'forced_pwm', 'none', 'selectable'] as const;
export const LightLoadMode = z.enum(LIGHT_LOAD_MODES);
export type LightLoadMode = z.output<typeof LightLoadMode>;

export const TEMPERATURE_REFERENCES = ['junction', 'ambient'] as const;
export const TemperatureReference = z.enum(TEMPERATURE_REFERENCES);
export type TemperatureReference = z.output<typeof TemperatureReference>;

const volts = quantityOf('V');
const amps = quantityOf('A');
const hertz = quantityOf('Hz');
const seconds = quantityOf('s');
const ohms = quantityOf('Ohm');
const percent = quantityOf('percent');
const celsius = z.strictObject({ value: Celsius, unit: z.literal('degC') });

/** Soft start: whether the part has it, and the fixed time when the datasheet states one. */
export const SoftStart = z
  .strictObject({ present: z.boolean(), time: seconds.nullable() })
  .superRefine((softStart, ctx) => {
    if (!softStart.present && softStart.time !== null) {
      ctx.addIssue({
        code: 'custom',
        message: 'a part without soft start cannot have a soft-start time',
        path: ['time'],
      });
    }
  });
export type SoftStart = z.output<typeof SoftStart>;

/**
 * The full parameter set for a buck regulator. Every field carries provenance.
 * Values the datasheet genuinely does not state are `null` with provenance
 * saying so; a missing key is a schema error.
 */
export const BuckRegulatorParameters = z
  .strictObject({
    vinMin: parameter(volts),
    vinMax: parameter(volts),
    vinAbsMax: parameter(volts),
    voutMin: parameter(volts),
    voutMax: parameter(volts),
    /** Fixed output voltage, or null for an adjustable part. */
    voutFixed: parameter(volts.nullable()),
    ioutMax: parameter(amps),
    /** Fixed frequency, or the adjustable range. */
    switchingFrequency: parameter(z.union([hertz, rangeOf('Hz')])),
    feedbackReference: parameter(volts.nullable()),
    feedbackAccuracy: parameter(percent.nullable()),
    quiescentCurrent: parameter(amps),
    shutdownCurrent: parameter(amps.nullable()),
    topology: parameter(Topology),
    integration: parameter(Integration),
    softStart: parameter(SoftStart),
    enablePin: parameter(z.boolean()),
    powerGoodPin: parameter(z.boolean()),
    lightLoadMode: parameter(LightLoadMode),
    externalSync: parameter(z.boolean()),
    operatingTempMin: parameter(celsius),
    operatingTempMax: parameter(celsius),
    temperatureReference: parameter(TemperatureReference),
    package: parameter(z.string().trim().min(1).max(64)),
    thermalPad: parameter(z.boolean()),
    minOnTime: parameter(seconds.nullable()),
    maxDutyCycle: parameter(percent.nullable()),
    efficiencyPeak: parameter(percent.nullable()),
    rdsOnHigh: parameter(ohms.nullable()),
    rdsOnLow: parameter(ohms.nullable()),
    aecQ100: parameter(z.boolean()),
  })
  .superRefine((p, ctx) => {
    const issue = (path: string[], message: string): void => {
      ctx.addIssue({ code: 'custom', message, path });
    };
    if (p.vinMin.value.value >= p.vinMax.value.value) {
      issue(['vinMax', 'value', 'value'], 'vinMax must be greater than vinMin');
    }
    if (p.vinMax.value.value > p.vinAbsMax.value.value) {
      issue(['vinAbsMax', 'value', 'value'], 'vinAbsMax must be greater than or equal to vinMax');
    }
    if (p.voutMin.value.value > p.voutMax.value.value) {
      issue(['voutMax', 'value', 'value'], 'voutMax must be greater than or equal to voutMin');
    }
    const fixed = p.voutFixed.value;
    if (
      fixed !== null &&
      (fixed.value !== p.voutMin.value.value || fixed.value !== p.voutMax.value.value)
    ) {
      issue(
        ['voutFixed', 'value', 'value'],
        'a fixed-output part must have voutMin and voutMax equal to voutFixed',
      );
    }
    if (p.operatingTempMin.value.value >= p.operatingTempMax.value.value) {
      issue(
        ['operatingTempMax', 'value', 'value'],
        'operatingTempMax must be greater than operatingTempMin',
      );
    }
    if (p.topology.value === 'non_synchronous' && p.rdsOnLow.value !== null) {
      issue(
        ['rdsOnLow', 'value'],
        'a non-synchronous part has no low-side FET, so rdsOnLow must be null',
      );
    }
    if (p.integration.value === 'controller') {
      if (p.rdsOnHigh.value !== null) {
        issue(
          ['rdsOnHigh', 'value'],
          'a controller has no integrated FETs, so rdsOnHigh must be null',
        );
      }
      if (p.rdsOnLow.value !== null) {
        issue(
          ['rdsOnLow', 'value'],
          'a controller has no integrated FETs, so rdsOnLow must be null',
        );
      }
    }
  });
export type BuckRegulatorParameters = z.output<typeof BuckRegulatorParameters>;
