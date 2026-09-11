import { z } from 'zod';

import {
  BuckRegulatorParameters,
  Category,
  Classification,
  Datasheet,
  Iso8601,
  ManufacturerName,
  NormalisedMpn,
  PACKAGE_FAMILIES,
  ParameterKey,
} from '../core/index.js';
import { PACKAGINGS } from '../core/offer.js';

/**
 * What the part number itself should say, read from the datasheet's ordering
 * information rather than from the decoder.
 *
 * This is what makes the golden set a check on Module 10 rather than a
 * restatement of it: the ordering table says what `D` and `R` mean, and the
 * decoder either agrees or is wrong.
 */
export const GoldenDecoded = z.strictObject({
  family: z.string().min(1),
  basePart: z.string().min(1),
  packageFamily: z.enum(PACKAGE_FAMILIES).nullable(),
  /** Lead count, or null where the ordering information does not give one. */
  pins: z.int().positive().nullable(),
  packaging: z.enum(PACKAGINGS),
  automotive: z.boolean(),
});
export type GoldenDecoded = z.output<typeof GoldenDecoded>;

/**
 * One part characterised by reading its datasheet.
 *
 * Every parameter carries a page number, including the ones that are null:
 * "the datasheet does not state this" is a fact about a page too, and the
 * note says what the page says instead.
 */
export const GoldenPart = z.strictObject({
  mpn: NormalisedMpn,
  manufacturer: ManufacturerName,
  category: Category,
  /** Why this part is in the set: what it covers that the others do not. */
  reason: z.string().trim().min(10).max(500),
  datasheet: Datasheet,
  parameters: BuckRegulatorParameters,
  /** Every axis, derived by hand from the parameters above. */
  classifications: z.array(Classification).min(1),
  decoded: GoldenDecoded,
  /** Per-parameter remarks: why a value is null, or which of several numbers was taken. */
  notes: z.partialRecord(ParameterKey, z.string().trim().min(1).max(500)),
  /** Who read the datasheet, and when. */
  readBy: z.string().trim().min(1).max(120),
  readAt: Iso8601,
});
export type GoldenPart = z.output<typeof GoldenPart>;
