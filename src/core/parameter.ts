import { z } from 'zod';

import { Provenance } from './provenance.js';

export const CONFIDENCES = ['extracted', 'verified', 'conflict'] as const;
export const Confidence = z.enum(CONFIDENCES);
export type Confidence = z.output<typeof Confidence>;

/** Wraps a value schema with mandatory provenance and confidence. */
export function parameter<T extends z.ZodType>(
  value: T,
): z.ZodObject<
  { value: T; provenance: typeof Provenance; confidence: typeof Confidence },
  z.core.$strict
> {
  return z.strictObject({ value, provenance: Provenance, confidence: Confidence });
}

export interface Parameter<T> {
  value: T;
  provenance: Provenance;
  confidence: Confidence;
}
