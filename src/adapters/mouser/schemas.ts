import { z } from 'zod';

/**
 * Response schemas for the Mouser Search API v1.
 *
 * Recorded against the live API on 2026-09-10. Objects are loose for the same
 * reason as the Digi-Key ones: an added field is not a reason to fail.
 *
 * Two shapes to note. Numbers arrive as **strings** (`Min`, `Mult`,
 * `AvailabilityInStock`), and a price is a formatted string with its symbol
 * (`"$1.62"`) alongside a separate `Currency`.
 */

export const MouserApiError = z.looseObject({
  Id: z.number().optional(),
  Code: z.string().optional(),
  Message: z.string().optional(),
  PropertyName: z.string().nullish(),
});
export type MouserApiError = z.output<typeof MouserApiError>;

export const MouserPriceBreak = z.looseObject({
  Quantity: z.number().int().nonnegative(),
  /** Formatted with a currency symbol, for example `"$1.62"`. */
  Price: z.string(),
  Currency: z.string(),
});
export type MouserPriceBreak = z.output<typeof MouserPriceBreak>;

export const MouserAttribute = z.looseObject({
  AttributeName: z.string(),
  AttributeValue: z.string(),
});
export type MouserAttribute = z.output<typeof MouserAttribute>;

export const MouserAlternatePackaging = z.looseObject({
  /** Sibling part number. Arrives with leading whitespace on all but the first. */
  APMfrPN: z.string(),
});

export const MouserPart = z.looseObject({
  ManufacturerPartNumber: z.string().min(1),
  Manufacturer: z.string().min(1),
  MouserPartNumber: z.string().min(1),
  Description: z.string().optional(),
  /** Empty for every switching regulator checked; Mouser is not a datasheet source in practice. */
  DataSheetUrl: z.string().optional(),
  ProductDetailUrl: z.string().optional(),
  Category: z.string().optional(),
  /** Free text such as `"2573 In Stock"`. `AvailabilityInStock` is the number. */
  Availability: z.string().optional(),
  AvailabilityInStock: z.string().nullish(),
  FactoryStock: z.string().nullish(),
  /** Minimum order quantity, as a string. */
  Min: z.string().nullish(),
  /** Order multiple, as a string. */
  Mult: z.string().nullish(),
  LeadTime: z.string().optional(),
  LifecycleStatus: z.string().nullish(),
  ProductAttributes: z.array(MouserAttribute).default([]),
  PriceBreaks: z.array(MouserPriceBreak).default([]),
  AlternatePackagings: z.array(MouserAlternatePackaging).nullish(),
  SuggestedReplacement: z.string().nullish(),
});
export type MouserPart = z.output<typeof MouserPart>;

export const MouserSearchResults = z.looseObject({
  NumberOfResult: z.number().int().nonnegative().default(0),
  Parts: z.array(MouserPart).default([]),
});

export const MouserSearchResponse = z.looseObject({
  Errors: z.array(MouserApiError).default([]),
  SearchResults: MouserSearchResults.nullish(),
});
export type MouserSearchResponse = z.output<typeof MouserSearchResponse>;
