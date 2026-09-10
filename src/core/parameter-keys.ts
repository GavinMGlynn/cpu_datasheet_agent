import { z } from 'zod';

/**
 * Every parameter of a buck regulator, in schema order. Kept in its own module
 * so provenance can reference keys without importing the parameter schema.
 * A test asserts this list matches the schema's keys exactly.
 */
export const PARAMETER_KEYS = [
  'vinMin',
  'vinMax',
  'vinAbsMax',
  'voutMin',
  'voutMax',
  'voutFixed',
  'ioutMax',
  'switchingFrequency',
  'feedbackReference',
  'feedbackAccuracy',
  'quiescentCurrent',
  'shutdownCurrent',
  'topology',
  'integration',
  'softStart',
  'enablePin',
  'powerGoodPin',
  'lightLoadMode',
  'externalSync',
  'operatingTempMin',
  'operatingTempMax',
  'temperatureReference',
  'package',
  'thermalPad',
  'minOnTime',
  'maxDutyCycle',
  'efficiencyPeak',
  'rdsOnHigh',
  'rdsOnLow',
  'aecQ100',
] as const;
export const ParameterKey = z.enum(PARAMETER_KEYS);
export type ParameterKey = z.output<typeof ParameterKey>;
