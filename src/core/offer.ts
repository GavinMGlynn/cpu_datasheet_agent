import { z } from 'zod';

import type { Currency } from './primitives.js';
import {
  Currency as CurrencySchema,
  Distributor,
  Iso8601,
  ManufacturerName,
  RawMpn,
} from './primitives.js';
import { DistributorProvenance } from './provenance.js';

export const PACKAGINGS = ['cut_tape', 'reel', 'tube', 'tray', 'bulk', 'unknown'] as const;
export const Packaging = z.enum(PACKAGINGS);
export type Packaging = z.output<typeof Packaging>;

export const PriceBreak = z.strictObject({
  quantity: z.number().int().min(1),
  unitPrice: z.number().min(0),
});
export type PriceBreak = z.output<typeof PriceBreak>;

/** One distributor listing. Price breaks are sorted by strictly increasing quantity. */
export const Offer = z
  .strictObject({
    distributor: Distributor,
    sku: z.string().trim().min(1).max(64),
    manufacturer: ManufacturerName,
    mpnAsListed: RawMpn,
    currency: CurrencySchema,
    priceBreaks: z.array(PriceBreak),
    stock: z.number().int().min(0),
    moq: z.number().int().min(1),
    packaging: Packaging,
    fetchedAt: Iso8601,
    provenance: DistributorProvenance,
  })
  .superRefine((offer, ctx) => {
    let previous: PriceBreak | undefined;
    offer.priceBreaks.forEach((current, index) => {
      if (previous !== undefined && current.quantity <= previous.quantity) {
        ctx.addIssue({
          code: 'custom',
          message: 'price break quantities must be strictly increasing',
          path: ['priceBreaks', index, 'quantity'],
        });
      }
      previous = current;
    });
    if (offer.provenance.distributor !== offer.distributor) {
      ctx.addIssue({
        code: 'custom',
        message: 'provenance distributor must match the offer distributor',
        path: ['provenance', 'distributor'],
      });
    }
    if (offer.provenance.sku !== offer.sku) {
      ctx.addIssue({
        code: 'custom',
        message: 'provenance sku must match the offer sku',
        path: ['provenance', 'sku'],
      });
    }
  });
export type Offer = z.output<typeof Offer>;

export interface BestPrice {
  readonly offer: Offer;
  readonly priceBreak: PriceBreak;
  readonly unitPrice: number;
  readonly currency: Currency;
  readonly quantity: number;
}

/**
 * The cheapest unit price for buying `quantity` in `currency`.
 *
 * Considers only offers whose minimum order quantity is met, and applies the
 * highest price break at or below the quantity. Returns undefined when no
 * offer qualifies; on a tie the first offer wins, so the order given decides.
 */
export function selectBestPrice(
  offers: readonly Offer[],
  quantity: number,
  currency: Currency,
): BestPrice | undefined {
  let best: BestPrice | undefined;
  for (const offer of offers) {
    if (offer.currency !== currency || quantity < offer.moq) {
      continue;
    }
    const applicable = offer.priceBreaks
      .filter((priceBreak) => priceBreak.quantity <= quantity)
      .at(-1);
    if (applicable === undefined) {
      continue;
    }
    if (best === undefined || applicable.unitPrice < best.unitPrice) {
      best = { offer, priceBreak: applicable, unitPrice: applicable.unitPrice, currency, quantity };
    }
  }
  return best;
}
