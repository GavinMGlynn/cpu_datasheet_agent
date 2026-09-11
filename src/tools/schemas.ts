import { z } from 'zod';

import {
  CLASSIFICATION_AXES,
  Distributor,
  DistributorProvenance,
  ObservedValue,
  Offer,
  PACKAGE_FAMILIES,
  ParameterKey,
} from '../core/index.js';
import { MANUFACTURER_KEYS, MPN_RELATIONS } from '../mpn/index.js';
import { PACKAGINGS } from '../core/offer.js';

/**
 * Schemas for values the tool surface returns that are internal types
 * elsewhere.
 *
 * These are a contract, not a dump: what a tool promises has to be stable
 * even when the type behind it changes shape. Each one has a type test
 * asserting it still matches the type it mirrors, so the two cannot drift
 * apart silently.
 */

export const TemperatureRangeSchema = z.strictObject({
  minC: z.number(),
  maxC: z.number(),
  reference: z.enum(['TJ', 'TA']).nullable(),
});

export const TemperatureGradeSchema = z.strictObject({
  code: z.string(),
  range: TemperatureRangeSchema.nullable(),
  guaranteed: TemperatureRangeSchema.nullable(),
});

export const PackageInfoSchema = z.strictObject({
  code: z.string(),
  family: z.enum(PACKAGE_FAMILIES).nullable(),
  description: z.string(),
  pins: z.number().nullable(),
});

export const DecodedMpnSchema = z.strictObject({
  mpn: z.string(),
  manufacturer: z.enum(MANUFACTURER_KEYS),
  family: z.string(),
  basePart: z.string(),
  package: PackageInfoSchema.nullable(),
  temperatureGrade: TemperatureGradeSchema.nullable(),
  packaging: z.enum(PACKAGINGS),
  leadFinish: z.string().nullable(),
  automotive: z.boolean(),
  extras: z.array(z.string()).readonly(),
});

export const MpnCandidateSchema = z.strictObject({
  distributor: Distributor,
  mpn: z.string(),
  mpnAsListed: z.string(),
  manufacturer: z.string(),
  decoded: DecodedMpnSchema.nullable(),
  datasheetUrl: z.string().optional(),
  offers: z.array(Offer).readonly(),
  siblings: z.array(z.string()).readonly(),
});

export const MpnMatchSchema = z.strictObject({
  candidate: MpnCandidateSchema,
  relation: z.enum(MPN_RELATIONS),
});

export const CandidateFailureSchema = z.strictObject({
  distributor: Distributor,
  code: z.string(),
  message: z.string(),
});

export const CandidateSkipSchema = z.strictObject({
  distributor: Distributor,
  mpnAsListed: z.string(),
  reason: z.string(),
});

export const PageMetricsSchema = z.strictObject({
  lineCount: z.number(),
  nonEmptyLineCount: z.number(),
  maxColumns: z.number(),
  medianColumns: z.number(),
  numericTokenCount: z.number(),
  orphanNumericLineCount: z.number(),
  orphanNumericRatio: z.number(),
  suspectTable: z.boolean(),
});

export const PageTextSchema = z.strictObject({
  page: z.number(),
  text: z.string(),
  metrics: PageMetricsSchema,
  hit: z.boolean(),
});

export const PdfInfoSchema = z.strictObject({
  pageCount: z.number(),
  title: z.string().optional(),
  producer: z.string().optional(),
  encrypted: z.boolean(),
});

export const SectionMatchSchema = z.strictObject({ page: z.number(), line: z.string() });

/** A distributor value keyed to the parameter it informs, as `src/units/` produces it. */
const KEYED_OBSERVATIONS = ObservedValue.options.map((option) =>
  option.extend({ key: ParameterKey }),
);
type KeyedObservation = (typeof KEYED_OBSERVATIONS)[number];

export const DistributorFactSchema = z.discriminatedUnion(
  'kind',
  // Derived from `ObservedValue`'s own options so the two cannot drift. The
  // list is a tuple at runtime and TypeScript loses that through `.map`,
  // which is all this restates.
  KEYED_OBSERVATIONS as [KeyedObservation, ...KeyedObservation[]],
);

/** One distributor's facts with the provenance they were read under. */
export const DistributorParametricsSchema = z.strictObject({
  provenance: DistributorProvenance,
  facts: z.array(DistributorFactSchema).readonly(),
});

export const ObservationSchema = z.strictObject({
  observed: ObservedValue,
  provenance: DistributorProvenance,
});

export const ComparedObservationSchema = ObservationSchema.extend({
  verdict: z.enum(['agree', 'conflict', 'incomparable']),
  rule: z.string(),
  detail: z.string(),
});

export const ReconciledParameterSchema = z.strictObject({
  key: ParameterKey,
  outcome: z.enum(['agree', 'conflict', 'datasheet_only', 'distributor_only']),
  safety: z.boolean(),
  observations: z.array(ObservationSchema).readonly(),
  comparisons: z.array(ComparedObservationSchema).readonly(),
});

export const UndecidedAxisSchema = z.strictObject({
  axis: z.enum(CLASSIFICATION_AXES),
  missing: z.array(ParameterKey).readonly(),
  reason: z.string(),
});
