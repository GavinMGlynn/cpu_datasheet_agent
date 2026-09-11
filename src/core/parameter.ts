import { z } from 'zod';

import { ParameterConflict } from './observation.js';
import { Provenance } from './provenance.js';

export const CONFIDENCES = ['extracted', 'verified', 'conflict'] as const;
export const Confidence = z.enum(CONFIDENCES);
export type Confidence = z.output<typeof Confidence>;

/**
 * Wraps a value schema with mandatory provenance and confidence.
 *
 * `conflicts` is the distributor values that disagree with this one, absent
 * when nothing disagrees and never empty when present. `Part` requires a
 * parameter carrying one to have confidence `conflict`.
 */
export function parameter<T extends z.ZodType>(
  value: T,
): z.ZodObject<
  {
    value: T;
    provenance: typeof Provenance;
    confidence: typeof Confidence;
    conflicts: z.ZodOptional<z.ZodArray<typeof ParameterConflict>>;
  },
  z.core.$strict
> {
  return z.strictObject({
    value,
    provenance: Provenance,
    confidence: Confidence,
    conflicts: z.array(ParameterConflict).min(1).optional(),
  });
}

export interface Parameter<T> {
  value: T;
  provenance: Provenance;
  confidence: Confidence;
  conflicts?: readonly ParameterConflict[] | undefined;
}
