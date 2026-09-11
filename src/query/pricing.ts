import type { Currency, Offer } from '../core/index.js';
import type { UnitPrice } from './types.js';

/**
 * What one part costs each, buying this many, from this offer.
 *
 * Price breaks are quantity thresholds: the price that applies is the highest
 * break at or below the quantity. Below the lowest break there is no price —
 * a reel of 3000 says nothing about buying one — and saying so is better than
 * quoting the 3000-up price to somebody buying a single part.
 */
export function unitPriceAt(offer: Offer, quantity: number): UnitPrice | null {
  let applicable: { quantity: number; unitPrice: number } | undefined;
  for (const priceBreak of offer.priceBreaks) {
    if (priceBreak.quantity <= quantity) {
      applicable = priceBreak;
    }
  }
  if (applicable === undefined) {
    return null;
  }
  return {
    amount: applicable.unitPrice,
    currency: offer.currency,
    breakQuantity: applicable.quantity,
    distributor: offer.distributor,
    sku: offer.sku,
    stock: offer.stock,
  };
}

/**
 * The cheapest way to buy this many of one part, in one currency.
 *
 * Prices in other currencies are ignored rather than converted: this project
 * holds no exchange rate, and a ranking built on a guessed one would be a
 * ranking of the guess.
 */
export function cheapestPrice(
  offers: readonly Offer[],
  quantity: number,
  currency: Currency,
): UnitPrice | null {
  let best: UnitPrice | null = null;
  for (const offer of offers) {
    if (offer.currency !== currency) {
      continue;
    }
    const price = unitPriceAt(offer, quantity);
    if (price !== null && (best === null || price.amount < best.amount)) {
      best = price;
    }
  }
  return best;
}
