import { z } from 'zod';

import { DistributorProvenance } from './provenance.js';
import { Quantity, QuantityRange } from './quantity.js';

export const OBSERVED_KINDS = [
  'quantity',
  'max',
  'min',
  'range',
  'enum',
  'boolean',
  'text',
] as const;
export type ObservedKind = (typeof OBSERVED_KINDS)[number];

/**
 * A value as a distributor states it, before anything is decided about it.
 *
 * `max` and `min` carry a stated bound rather than a value: Digi-Key writes
 * `Up to 1MHz` for an adjustable frequency, which says the parameter is at
 * most 1 MHz and says nothing about its lower end. The kinds mirror
 * `DistributorFact` in `src/units/`, which is this shape plus the parameter
 * key it belongs to, so a fact can be stored without being reshaped.
 */
export const ObservedValue = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('quantity'), value: Quantity }),
  z.strictObject({ kind: z.literal('max'), value: Quantity }),
  z.strictObject({ kind: z.literal('min'), value: Quantity }),
  z.strictObject({ kind: z.literal('range'), value: QuantityRange }),
  z.strictObject({ kind: z.literal('enum'), value: z.string().trim().min(1).max(64) }),
  z.strictObject({ kind: z.literal('boolean'), value: z.boolean() }),
  z.strictObject({ kind: z.literal('text'), value: z.string().trim().min(1).max(500) }),
]);
export type ObservedValue = z.output<typeof ObservedValue>;

/**
 * A distributor value that disagrees with the one the parameter holds.
 *
 * Recorded on the parameter rather than thrown away, so the part carries the
 * disagreement with it: a reader sees both numbers and where each came from.
 * `rule` names the comparison that judged them to disagree, so a tolerance
 * that turns out to be wrong can be found from the data it produced.
 */
export const ParameterConflict = z.strictObject({
  observed: ObservedValue,
  provenance: DistributorProvenance,
  rule: z.string().trim().min(1).max(128),
});
export type ParameterConflict = z.output<typeof ParameterConflict>;
