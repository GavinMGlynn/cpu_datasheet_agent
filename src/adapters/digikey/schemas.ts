import { z } from 'zod';

/**
 * Response schemas for Digi-Key Product Information v4.
 *
 * Objects are loose: Digi-Key adds fields over time, and an unknown field is
 * not a reason to reject a response. Every field the adapter reads is
 * declared, so a field that disappears or changes type fails loudly.
 * Recorded against the live API on 2026-09-10; see the module README.
 */

export const SearchLocale = z.looseObject({
  Site: z.string(),
  Language: z.string(),
  Currency: z.string(),
});
export type SearchLocale = z.output<typeof SearchLocale>;

export const DigiKeyPriceBreak = z.looseObject({
  BreakQuantity: z.number().int().nonnegative(),
  UnitPrice: z.number().nonnegative(),
  TotalPrice: z.number().nonnegative(),
});
export type DigiKeyPriceBreak = z.output<typeof DigiKeyPriceBreak>;

export const DigiKeyPackageType = z.looseObject({
  Id: z.number().optional(),
  Name: z.string(),
});

/** One orderable Digi-Key SKU: a packaging option of the manufacturer part. */
export const DigiKeyProductVariation = z.looseObject({
  DigiKeyProductNumber: z.string().min(1),
  PackageType: DigiKeyPackageType.optional(),
  StandardPricing: z.array(DigiKeyPriceBreak).default([]),
  MinimumOrderQuantity: z.number().int().nonnegative().optional(),
  QuantityAvailableforPackageType: z.number().int().nonnegative().optional(),
  StandardPackage: z.number().int().nonnegative().optional(),
  /** True for third-party marketplace stock rather than Digi-Key's own. */
  MarketPlace: z.boolean().optional(),
  DigiReelFee: z.number().nonnegative().optional(),
});
export type DigiKeyProductVariation = z.output<typeof DigiKeyProductVariation>;

export const DigiKeyParameter = z.looseObject({
  ParameterId: z.number().optional(),
  ParameterText: z.string(),
  ValueText: z.string(),
});
export type DigiKeyParameter = z.output<typeof DigiKeyParameter>;

export const DigiKeyProduct = z.looseObject({
  ManufacturerProductNumber: z.string().min(1),
  Manufacturer: z.looseObject({ Id: z.number().optional(), Name: z.string() }),
  Description: z
    .looseObject({
      ProductDescription: z.string().optional(),
      DetailedDescription: z.string().optional(),
    })
    .optional(),
  DatasheetUrl: z.string().optional(),
  ProductUrl: z.string().optional(),
  QuantityAvailable: z.number().int().nonnegative().optional(),
  Parameters: z.array(DigiKeyParameter).default([]),
  ProductVariations: z.array(DigiKeyProductVariation).default([]),
  /**
   * The family part number the variations belong to, useful for MPN
   * resolution. Present but with no `Name` on some keyword-search results, so
   * the inner field is optional even though the object usually carries it.
   */
  BaseProductNumber: z
    .looseObject({ Id: z.number().optional(), Name: z.string().optional() })
    .optional(),
  Category: z.looseObject({ Name: z.string().optional() }).optional(),
  ProductStatus: z.looseObject({ Status: z.string().optional() }).optional(),
  Discontinued: z.boolean().optional(),
  EndOfLife: z.boolean().optional(),
});
export type DigiKeyProduct = z.output<typeof DigiKeyProduct>;

export const ProductDetailsResponse = z.looseObject({
  Product: DigiKeyProduct,
  SearchLocaleUsed: SearchLocale.optional(),
});
export type ProductDetailsResponse = z.output<typeof ProductDetailsResponse>;

export const KeywordSearchResponse = z.looseObject({
  Products: z.array(DigiKeyProduct).default([]),
  ProductsCount: z.number().int().nonnegative().default(0),
  ExactMatches: z.array(DigiKeyProduct).default([]),
  SearchLocaleUsed: SearchLocale.optional(),
});
export type KeywordSearchResponse = z.output<typeof KeywordSearchResponse>;

/** The pricing endpoint returns the same variations as product details. */
export const PricingResponse = z.looseObject({
  ProductPricings: z
    .array(
      z.looseObject({
        ManufacturerProductNumber: z.string().min(1),
        Manufacturer: z.looseObject({ Name: z.string() }).optional(),
        ProductVariations: z.array(DigiKeyProductVariation).default([]),
      }),
    )
    .default([]),
  ProductsCount: z.number().int().nonnegative().optional(),
  SettingsUsed: z.looseObject({ SearchLocale: SearchLocale.optional() }).optional(),
});
export type PricingResponse = z.output<typeof PricingResponse>;

export const MediaLink = z.looseObject({
  MediaType: z.string(),
  Title: z.string().optional(),
  Url: z.string(),
});
export type MediaLink = z.output<typeof MediaLink>;

export const MediaResponse = z.looseObject({
  MediaLinks: z.array(MediaLink).default([]),
});
export type MediaResponse = z.output<typeof MediaResponse>;

export const SubstitutionsResponse = z.looseObject({
  ProductSubstitutes: z
    .array(
      z.looseObject({
        ManufacturerProductNumber: z.string().min(1),
        Manufacturer: z.looseObject({ Name: z.string() }).optional(),
        SubstituteType: z.string().optional(),
      }),
    )
    .default([]),
  ProductSubstitutesCount: z.number().int().nonnegative().optional(),
});
export type SubstitutionsResponse = z.output<typeof SubstitutionsResponse>;

/**
 * Alternate packaging items are leaner than a full product and use a string
 * `Description` and `UnitPrice`, unlike product details where `Description` is
 * an object and `UnitPrice` a number. The array is nested one level.
 */
export const AlternatePackagingItem = z.looseObject({
  ManufacturerProductNumber: z.string().min(1),
  Manufacturer: z.looseObject({ Name: z.string() }).optional(),
  DigiKeyProductNumber: z.string().optional(),
  Description: z.string().optional(),
  UnitPrice: z.union([z.number(), z.string()]).optional(),
  QuantityAvailable: z.number().int().nonnegative().optional(),
  ProductUrl: z.string().optional(),
});
export type AlternatePackagingItem = z.output<typeof AlternatePackagingItem>;

export const AlternatePackagingResponse = z.looseObject({
  AlternatePackagings: z
    .looseObject({ AlternatePackaging: z.array(AlternatePackagingItem).default([]) })
    .optional(),
  SearchLocaleUsed: SearchLocale.optional(),
});
export type AlternatePackagingResponse = z.output<typeof AlternatePackagingResponse>;
