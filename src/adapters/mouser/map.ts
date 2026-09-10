import { Offer, type Packaging } from '../../core/offer.js';
import type { Currency } from '../../core/primitives.js';
import { parseOrThrow } from '../../core/validation-error.js';
import { elementAt } from '../../util/array.js';
import { MouserError } from './errors.js';
import type { MouserPart } from './schemas.js';

/** Packaging names Mouser uses. `MouseReel` is its own re-reeling service. */
const PACKAGING_RULES: readonly (readonly [RegExp, Packaging])[] = [
  [/cut tape/i, 'cut_tape'],
  [/mouse\s*-?reel|\breel\b/i, 'reel'],
  [/\btube\b/i, 'tube'],
  [/\btray\b/i, 'tray'],
  [/\bbulk\b|\bbox\b|\bbag\b|\bstrip\b/i, 'bulk'],
];

export const PACKAGING_ATTRIBUTE = 'Packaging';

export function packagingOf(name: string): Packaging {
  for (const [pattern, packaging] of PACKAGING_RULES) {
    if (pattern.test(name)) {
      return packaging;
    }
  }
  return 'unknown';
}

/**
 * The packaging of a Mouser listing, or `unknown` when it offers several.
 *
 * Mouser sells one part number in several packagings under a single SKU, so
 * `Reel, Cut Tape, MouseReel` describes what you may choose rather than what
 * you get. Recording one of them would assert something the listing does not
 * say.
 */
export function listingPackaging(part: MouserPart): Packaging {
  const named = part.ProductAttributes.filter(
    (attribute) => attribute.AttributeName === PACKAGING_ATTRIBUTE,
  ).map((attribute) => packagingOf(attribute.AttributeValue));
  const distinct = [...new Set(named)];
  return distinct.length === 1 ? elementAt(distinct, 0) : 'unknown';
}

/**
 * Reads a Mouser price such as `"$1.62"` or `"1,62 €"`.
 *
 * Mouser formats the price for its site rather than sending a number, so the
 * symbol and the separators have to be stripped. A price that cannot be read
 * throws: dropping the break would silently change the price curve.
 */
export function parsePrice(text: string, context: string): number {
  const digits = text.replace(/[^\d,.-]/g, '').trim();
  const hasComma = digits.includes(',');
  const hasDot = digits.includes('.');
  let normalised = digits;
  if (hasComma && hasDot) {
    // Whichever separator comes last is the decimal one.
    normalised =
      digits.lastIndexOf(',') > digits.lastIndexOf('.')
        ? digits.replace(/\./g, '').replace(',', '.')
        : digits.replace(/,/g, '');
  } else if (hasComma) {
    normalised = digits.replace(',', '.');
  }
  const value = Number(normalised);
  if (!Number.isFinite(value) || normalised === '') {
    throw new MouserError(
      'MOUSER_RESPONSE_INVALID',
      `cannot read the price "${text}" for ${context}`,
      {
        details: { price: text, context },
      },
    );
  }
  return value;
}

function integerOf(text: string | null | undefined, fallback: number): number {
  if (text === null || text === undefined) {
    return fallback;
  }
  const value = Number(text.replace(/[^\d-]/g, ''));
  return Number.isInteger(value) ? value : fallback;
}

export interface OfferContext {
  readonly fetchedAt: string;
  /** Hash of the cache key the response came from, for provenance. */
  readonly cacheKey: string;
  /** Used when a listing carries no price breaks to name a currency. */
  readonly fallbackCurrency: Currency;
}

/**
 * One validated offer per Mouser listing.
 *
 * Unlike Digi-Key, Mouser lists one SKU per part number rather than one per
 * packaging, so a part yields a single offer. Prices come back in the
 * account's currency, which is not necessarily the currency Digi-Key was asked
 * for; comparisons must filter by currency rather than assume one.
 */
export function toOffer(part: MouserPart, context: OfferContext): Offer {
  const byQuantity = new Map<number, number>();
  for (const priceBreak of part.PriceBreaks) {
    if (priceBreak.Quantity >= 1) {
      byQuantity.set(priceBreak.Quantity, parsePrice(priceBreak.Price, part.MouserPartNumber));
    }
  }
  const priceBreaks = [...byQuantity.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([quantity, unitPrice]) => ({ quantity, unitPrice }));

  return parseOrThrow(
    Offer,
    {
      distributor: 'mouser',
      sku: part.MouserPartNumber,
      manufacturer: part.Manufacturer,
      mpnAsListed: part.ManufacturerPartNumber,
      currency: part.PriceBreaks[0]?.Currency ?? context.fallbackCurrency,
      priceBreaks,
      stock: Math.max(0, integerOf(part.AvailabilityInStock, 0)),
      moq: Math.max(1, integerOf(part.Min, 1)),
      packaging: listingPackaging(part),
      fetchedAt: context.fetchedAt,
      provenance: {
        source: 'distributor',
        distributor: 'mouser',
        sku: part.MouserPartNumber,
        fetchedAt: context.fetchedAt,
        cacheKey: context.cacheKey,
      },
    },
    `Mouser offer ${part.MouserPartNumber}`,
  );
}

/** Mouser's datasheet link, which is empty for every switching regulator checked. */
export function datasheetUrlOf(part: MouserPart): string | undefined {
  const url = part.DataSheetUrl;
  return url === undefined || url.trim() === '' ? undefined : url.trim();
}

/**
 * Part numbers Mouser lists as alternate packagings of the same part.
 *
 * These are siblings for MPN resolution, not substitutes. Mouser returns them
 * with leading whitespace on all but the first, so they are trimmed, and the
 * part's own number is removed.
 */
export function siblingMpns(part: MouserPart): readonly string[] {
  const own = part.ManufacturerPartNumber.trim().toUpperCase();
  const seen = new Set<string>();
  for (const alternate of part.AlternatePackagings ?? []) {
    const mpn = alternate.APMfrPN.trim();
    if (mpn !== '' && mpn.toUpperCase() !== own) {
      seen.add(mpn);
    }
  }
  return [...seen];
}

/**
 * Mouser attribute names that carry a schema parameter.
 *
 * There are none. Across every switching regulator checked on 2026-09-10 the
 * Search API returned only `Packaging` and `Standard Pack Qty`, which describe
 * the listing rather than the part. Mouser contributes price, stock and
 * siblings; parametrics come from Digi-Key and the datasheet. Names are
 * reported as unmapped rather than guessed at, so this list grows only from
 * real data.
 */
export const MAPPED_ATTRIBUTE_NAMES: readonly string[] = Object.freeze([]);

/**
 * Attribute names the adapter did not recognise, for the record.
 *
 * `mapped` is a parameter rather than a constant read directly so the
 * filtering stays exercised while the real list is empty.
 */
export function unmappedAttributes(
  part: MouserPart,
  mapped: readonly string[] = MAPPED_ATTRIBUTE_NAMES,
): readonly string[] {
  const seen = new Set<string>();
  for (const attribute of part.ProductAttributes) {
    if (!mapped.includes(attribute.AttributeName)) {
      seen.add(attribute.AttributeName);
    }
  }
  return [...seen];
}
