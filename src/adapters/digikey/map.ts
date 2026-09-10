import type { Currency } from '../../core/primitives.js';
import { Offer, type Packaging } from '../../core/offer.js';
import { parseOrThrow } from '../../core/validation-error.js';
import {
  digikeyParameterToKey,
  tryParseDistributorValue,
  type DistributorFact,
} from '../../units/index.js';
import type { DigiKeyProduct, MediaResponse } from './schemas.js';

/**
 * Digi-Key packaging names, matched case-insensitively as substrings.
 * `Digi-Reel` is a paid re-reeling of cut tape, so it is recorded as a reel.
 */
const PACKAGING_RULES: readonly (readonly [RegExp, Packaging])[] = [
  [/cut tape/i, 'cut_tape'],
  [/digi-?reel/i, 'reel'],
  [/tape\s*(&|and)\s*reel|\breel\b/i, 'reel'],
  [/\btube\b/i, 'tube'],
  [/\btray\b/i, 'tray'],
  [/\bbulk\b|\bbox\b|\bbag\b|\bstrip\b/i, 'bulk'],
];

export function packagingOf(name: string | undefined): Packaging {
  if (name === undefined) {
    return 'unknown';
  }
  for (const [pattern, packaging] of PACKAGING_RULES) {
    if (pattern.test(name)) {
      return packaging;
    }
  }
  return 'unknown';
}

export interface OfferContext {
  readonly fetchedAt: string;
  /** Hash of the cache key the response came from, for provenance. */
  readonly cacheKey: string;
  readonly currency: Currency;
  /** Include third-party marketplace listings. Off by default: they are not Digi-Key stock. */
  readonly includeMarketplace?: boolean;
}

/**
 * Turns a product's packaging variations into offers, one per Digi-Key SKU.
 *
 * Price breaks are sorted and de-duplicated by quantity, and breaks below
 * quantity one are dropped, because the schema requires strictly increasing
 * positive quantities. Every offer is validated before it is returned.
 */
export function toOffers(product: DigiKeyProduct, context: OfferContext): Offer[] {
  const offers: Offer[] = [];
  for (const variation of product.ProductVariations) {
    if (variation.MarketPlace === true && context.includeMarketplace !== true) {
      continue;
    }
    const byQuantity = new Map<number, number>();
    for (const priceBreak of variation.StandardPricing) {
      if (priceBreak.BreakQuantity >= 1) {
        byQuantity.set(priceBreak.BreakQuantity, priceBreak.UnitPrice);
      }
    }
    const priceBreaks = [...byQuantity.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([quantity, unitPrice]) => ({ quantity, unitPrice }));

    offers.push(
      parseOrThrow(
        Offer,
        {
          distributor: 'digikey',
          sku: variation.DigiKeyProductNumber,
          manufacturer: product.Manufacturer.Name,
          mpnAsListed: product.ManufacturerProductNumber,
          currency: context.currency,
          priceBreaks,
          stock: variation.QuantityAvailableforPackageType ?? product.QuantityAvailable ?? 0,
          moq: Math.max(1, variation.MinimumOrderQuantity ?? 1),
          packaging: packagingOf(variation.PackageType?.Name),
          fetchedAt: context.fetchedAt,
          provenance: {
            source: 'distributor',
            distributor: 'digikey',
            sku: variation.DigiKeyProductNumber,
            fetchedAt: context.fetchedAt,
            cacheKey: context.cacheKey,
          },
        },
        `Digi-Key offer ${variation.DigiKeyProductNumber}`,
      ),
    );
  }
  return offers;
}

/** The datasheet URL from a product, if it has one. Often a manufacturer redirect. */
export function datasheetUrlOf(product: DigiKeyProduct): string | undefined {
  const url = product.DatasheetUrl;
  return url === undefined || url.trim() === '' ? undefined : url;
}

/** The first datasheet link from the media endpoint. */
export function datasheetUrlFromMedia(media: MediaResponse): string | undefined {
  return media.MediaLinks.find((link) => /datasheet/i.test(link.MediaType))?.Url;
}

export interface ParametricFailure {
  readonly name: string;
  readonly value: string;
  readonly reason: string;
}

export interface ParametricResult {
  readonly facts: readonly DistributorFact[];
  /** Parameter names that carry no schema parameter. Feeds the mapping table. */
  readonly unmapped: readonly string[];
  /** Names that map to a parameter but whose value could not be parsed. */
  readonly failures: readonly ParametricFailure[];
}

/**
 * Converts a product's parametric block into schema-keyed facts.
 *
 * A name with no mapping is reported rather than dropped, so the mapping table
 * can be extended from real data. A value that fails to parse is reported too;
 * it is never guessed at.
 */
export function parametricFacts(product: DigiKeyProduct): ParametricResult {
  const facts: DistributorFact[] = [];
  const unmapped: string[] = [];
  const failures: ParametricFailure[] = [];

  for (const parameter of product.Parameters) {
    const mapping = digikeyParameterToKey(parameter.ParameterText);
    if (mapping === null) {
      unmapped.push(parameter.ParameterText);
      continue;
    }
    const parsed = tryParseDistributorValue(mapping, parameter.ValueText);
    if (parsed.ok) {
      facts.push(...parsed.value);
    } else {
      failures.push({
        name: parameter.ParameterText,
        value: parameter.ValueText,
        reason: parsed.error.message,
      });
    }
  }
  return { facts, unmapped, failures };
}
