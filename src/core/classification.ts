import { z } from 'zod';

import { ParameterKey } from './parameter-keys.js';

export const VIN_CLASSES = ['le_5v5', 'le_18v', 'le_42v', 'le_60v', 'gt_60v'] as const;
export const IOUT_CLASSES = ['le_1a', 'le_3a', 'le_6a', 'le_12a', 'gt_12a'] as const;
export const OUTPUT_TYPES = ['fixed', 'adjustable'] as const;
export const PACKAGE_FAMILIES = [
  'sot23',
  'sot223',
  'soic',
  'msop',
  'tssop',
  'qfn',
  'dfn',
  'to220',
  'to263',
  'other',
] as const;
export const TEMPERATURE_GRADES = ['commercial', 'industrial', 'extended', 'automotive'] as const;
export const FEATURES = ['enable', 'power_good', 'soft_start', 'sync', 'light_load'] as const;

const base = {
  /** Parameters the value was derived from. */
  derivedFrom: z.array(ParameterKey).min(1),
  /** Identifier of the rule in the classify module. */
  rule: z.string().trim().min(1).max(128),
};

const uniqueFeatures = z.array(z.enum(FEATURES)).superRefine((features, ctx) => {
  const seen = new Set<string>();
  features.forEach((feature, index) => {
    if (seen.has(feature)) {
      ctx.addIssue({ code: 'custom', message: `duplicate feature ${feature}`, path: [index] });
    }
    seen.add(feature);
  });
});

/** One categorisation axis with its value. The value set is fixed per axis. */
export const Classification = z.discriminatedUnion('axis', [
  z.strictObject({ axis: z.literal('vinClass'), value: z.enum(VIN_CLASSES), ...base }),
  z.strictObject({ axis: z.literal('ioutClass'), value: z.enum(IOUT_CLASSES), ...base }),
  z.strictObject({
    axis: z.literal('topology'),
    value: z.enum(['synchronous', 'non_synchronous']),
    ...base,
  }),
  z.strictObject({
    axis: z.literal('integration'),
    value: z.enum(['integrated_fet', 'controller']),
    ...base,
  }),
  z.strictObject({ axis: z.literal('outputType'), value: z.enum(OUTPUT_TYPES), ...base }),
  z.strictObject({ axis: z.literal('packageFamily'), value: z.enum(PACKAGE_FAMILIES), ...base }),
  z.strictObject({
    axis: z.literal('temperatureGrade'),
    value: z.enum(TEMPERATURE_GRADES),
    ...base,
  }),
  z.strictObject({ axis: z.literal('features'), value: uniqueFeatures, ...base }),
]);
export type Classification = z.output<typeof Classification>;
export type ClassificationAxis = Classification['axis'];

export const CLASSIFICATION_AXES = [
  'vinClass',
  'ioutClass',
  'topology',
  'integration',
  'outputType',
  'packageFamily',
  'temperatureGrade',
  'features',
] as const satisfies readonly ClassificationAxis[];
