import { describe, expect, it } from 'vitest';

import {
  distributorProvenance,
  offer as offerFixture,
  priceBreaks,
} from '../../test/helpers/core-fixtures.js';
import { Offer, parseOrThrow } from '../core/index.js';
import { cheapestPrice, unitPriceAt } from './pricing.js';

function offer(overrides: Record<string, unknown> = {}): Offer {
  return parseOrThrow(Offer, offerFixture(overrides), 'Offer');
}

/** The same part at another distributor, whose provenance has to agree. */
function mouser(overrides: Record<string, unknown> = {}): Offer {
  return offer({
    distributor: 'mouser',
    sku: '595-TPS54331DR',
    provenance: distributorProvenance({ distributor: 'mouser', sku: '595-TPS54331DR' }),
    ...overrides,
  });
}

describe('unitPriceAt', () => {
  it('takes the highest break at or below the quantity', () => {
    const one = offer();

    expect(unitPriceAt(one, 1)?.amount).toBe(2.31);
    expect(unitPriceAt(one, 9)?.amount).toBe(2.31);
    expect(unitPriceAt(one, 10)?.amount).toBe(1.98);
    expect(unitPriceAt(one, 99)?.amount).toBe(1.98);
    expect(unitPriceAt(one, 100)?.amount).toBe(1.42);
    expect(unitPriceAt(one, 5000)?.amount).toBe(1.42);
  });

  it('carries where the price came from', () => {
    expect(unitPriceAt(offer(), 250)).toEqual({
      amount: 1.42,
      currency: 'AUD',
      breakQuantity: 100,
      distributor: 'digikey',
      sku: '296-28446-1-ND',
      stock: 12000,
    });
  });

  it('says nothing rather than quoting a reel price to someone buying one', () => {
    const reel = offer({ priceBreaks: priceBreaks().slice(2) });

    expect(unitPriceAt(reel, 1)).toBeNull();
    expect(unitPriceAt(reel, 100)?.amount).toBe(1.42);
  });

  it('says nothing for an offer with no price breaks at all', () => {
    expect(unitPriceAt(offer({ priceBreaks: [] }), 10)).toBeNull();
  });
});

describe('cheapestPrice', () => {
  it('takes the cheapest offer in the currency asked about', () => {
    const offers = [offer(), mouser({ priceBreaks: [{ quantity: 1, unitPrice: 1.99 }] })];

    expect(cheapestPrice(offers, 1, 'AUD')).toMatchObject({ amount: 1.99, distributor: 'mouser' });
  });

  it('ignores a cheaper price in another currency rather than converting it', () => {
    const offers = [
      offer(),
      mouser({ currency: 'USD', priceBreaks: [{ quantity: 1, unitPrice: 0.99 }] }),
    ];

    expect(cheapestPrice(offers, 1, 'AUD')).toMatchObject({ amount: 2.31, currency: 'AUD' });
    expect(cheapestPrice(offers, 1, 'USD')).toMatchObject({ amount: 0.99, currency: 'USD' });
    expect(cheapestPrice(offers, 1, 'EUR')).toBeNull();
  });

  it('says nothing when no offer prices that quantity', () => {
    expect(cheapestPrice([offer({ priceBreaks: priceBreaks().slice(2) })], 1, 'AUD')).toBeNull();
    expect(cheapestPrice([], 1, 'AUD')).toBeNull();
  });
});
