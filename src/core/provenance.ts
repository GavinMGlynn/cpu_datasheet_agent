import { z } from 'zod';

import { ParameterKey } from './parameter-keys.js';
import { Distributor, Iso8601, PageNumber, Sha256 } from './primitives.js';

/** A value read from a datasheet. The page number is mandatory: no page, no store. */
export const DatasheetProvenance = z.strictObject({
  source: z.literal('datasheet'),
  sha256: Sha256,
  page: PageNumber,
  method: z.enum(['text', 'image']),
  quote: z.string().trim().min(1).max(500).optional(),
});
export type DatasheetProvenance = z.output<typeof DatasheetProvenance>;

/** A value taken from a distributor's parametric data. */
export const DistributorProvenance = z.strictObject({
  source: z.literal('distributor'),
  distributor: Distributor,
  sku: z.string().trim().min(1).max(64),
  fetchedAt: Iso8601,
  cacheKey: Sha256,
});
export type DistributorProvenance = z.output<typeof DistributorProvenance>;

/** A value entered or confirmed by a person. */
export const HumanProvenance = z.strictObject({
  source: z.literal('human'),
  note: z.string().trim().min(1).max(1000),
  recordedAt: Iso8601,
});
export type HumanProvenance = z.output<typeof HumanProvenance>;

/** A value computed from other parameters by a named rule. */
export const DerivedProvenance = z.strictObject({
  source: z.literal('derived'),
  from: z.array(ParameterKey).min(1),
  rule: z.string().trim().min(1).max(128),
});
export type DerivedProvenance = z.output<typeof DerivedProvenance>;

export const Provenance = z.discriminatedUnion('source', [
  DatasheetProvenance,
  DistributorProvenance,
  HumanProvenance,
  DerivedProvenance,
]);
export type Provenance = z.output<typeof Provenance>;
