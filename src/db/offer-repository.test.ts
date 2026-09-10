import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ValidationError } from '../core/validation-error.js';
import { distributorProvenance, offer, part } from '../../test/helpers/core-fixtures.js';
import type { Db } from './database.js';
import { DbError, requireRow } from './database.js';
import { OfferRepository } from './offer-repository.js';
import { openDatabase } from './open.js';
import { PartRepository } from './part-repository.js';

let db: Db;
let offers: OfferRepository;
let partId: number;

function mouser(sku: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return offer({
    distributor: 'mouser',
    sku,
    provenance: distributorProvenance({ distributor: 'mouser', sku }),
    ...extra,
  });
}

beforeEach(() => {
  db = openDatabase(':memory:');
  offers = new OfferRepository(db);
  const parts = new PartRepository(db);
  parts.upsertPart(part({ offers: [] }));
  partId = requireRow(parts.getPartId('TPS54331DR'), 'part id');
});

afterEach(() => {
  db.close();
});

describe('OfferRepository.replaceOffers', () => {
  it('stores offers for one distributor and returns them', () => {
    const stored = offers.replaceOffers(partId, 'digikey', [offer()]);
    expect(stored).toEqual([offer()]);
    expect(offers.getOffers(partId)).toEqual([offer()]);
  });

  it('replaces only that distributor, leaving others untouched', () => {
    offers.replaceOffers(partId, 'digikey', [
      offer(),
      offer({ sku: 'B', provenance: distributorProvenance({ sku: 'B' }) }),
    ]);
    offers.replaceOffers(partId, 'mouser', [mouser('595-1')]);
    offers.replaceOffers(partId, 'digikey', [offer({ stock: 1 })]);

    expect(
      offers
        .getOffers(partId)
        .map((stored) => `${stored.distributor}:${stored.sku}:${String(stored.stock)}`),
    ).toEqual(['digikey:296-28446-1-ND:1', 'mouser:595-1:12000']);
  });

  it('clears a distributor when given no offers', () => {
    offers.replaceOffers(partId, 'digikey', [offer()]);
    expect(offers.replaceOffers(partId, 'digikey', [])).toEqual([]);
    expect(offers.getOffers(partId)).toEqual([]);
  });

  it('rejects offers from another distributor and invalid offers, writing nothing', () => {
    expect(() => offers.replaceOffers(partId, 'digikey', [mouser('595-1')])).toThrow(DbError);
    try {
      offers.replaceOffers(partId, 'digikey', [mouser('595-1')]);
    } catch (error) {
      expect((error as DbError).code).toBe('DB_OFFER_DISTRIBUTOR_MISMATCH');
    }
    expect(() => offers.replaceOffers(partId, 'digikey', [offer({ moq: 0 })])).toThrow(
      ValidationError,
    );
    expect(offers.getOffers(partId)).toEqual([]);
  });

  it('orders offers by distributor then sku and price breaks by quantity', () => {
    offers.replaceOffers(partId, 'mouser', [mouser('595-2'), mouser('595-1')]);
    offers.replaceOffers(partId, 'digikey', [
      offer({
        priceBreaks: [
          { quantity: 100, unitPrice: 1 },
          { quantity: 1, unitPrice: 2 },
        ].sort((a, b) => a.quantity - b.quantity),
      }),
    ]);
    const stored = offers.getOffers(partId);
    expect(stored.map((s) => `${s.distributor}:${s.sku}`)).toEqual([
      'digikey:296-28446-1-ND',
      'mouser:595-1',
      'mouser:595-2',
    ]);
    expect(stored[0]?.priceBreaks.map((b) => b.quantity)).toEqual([1, 100]);
  });
});

describe('OfferRepository.bestPriceAt', () => {
  beforeEach(() => {
    offers.replaceOffers(partId, 'digikey', [
      offer({
        priceBreaks: [
          { quantity: 1, unitPrice: 2.31 },
          { quantity: 10, unitPrice: 1.98 },
          { quantity: 100, unitPrice: 1.42 },
        ],
      }),
    ]);
    offers.replaceOffers(partId, 'mouser', [
      mouser('595-reel', { moq: 2500, priceBreaks: [{ quantity: 2500, unitPrice: 0.3 }] }),
      mouser('595-cut', {
        priceBreaks: [
          { quantity: 1, unitPrice: 2.4 },
          { quantity: 10, unitPrice: 1.9 },
        ],
      }),
      mouser('595-usd', { currency: 'USD', priceBreaks: [{ quantity: 1, unitPrice: 0.01 }] }),
      mouser('595-min5', { priceBreaks: [{ quantity: 5, unitPrice: 0.5 }] }),
    ]);
  });

  it('picks the cheapest applicable break in the requested currency', () => {
    const one = offers.bestPriceAt(partId, 1, 'AUD');
    expect(one?.offer.sku).toBe('296-28446-1-ND');
    expect(one?.unitPrice).toBe(2.31);
    expect(one?.priceBreak).toEqual({ quantity: 1, unitPrice: 2.31 });
    expect(one?.quantity).toBe(1);
    expect(one?.currency).toBe('AUD');

    const ten = offers.bestPriceAt(partId, 10, 'AUD');
    expect(ten?.offer.sku).toBe('595-min5');
    expect(ten?.unitPrice).toBe(0.5);

    const reel = offers.bestPriceAt(partId, 3000, 'AUD');
    expect(reel?.offer.sku).toBe('595-reel');
    expect(reel?.unitPrice).toBe(0.3);
  });

  it('ignores offers whose MOQ is not met, and other currencies', () => {
    expect(offers.bestPriceAt(partId, 2499, 'AUD')?.offer.sku).toBe('595-min5');
    expect(offers.bestPriceAt(partId, 1, 'USD')?.offer.sku).toBe('595-usd');
  });

  it('keeps the first offer on a tie', () => {
    offers.replaceOffers(partId, 'digikey', [
      offer({ priceBreaks: [{ quantity: 1, unitPrice: 0.5 }] }),
    ]);
    offers.replaceOffers(partId, 'mouser', [
      mouser('595-tie', { priceBreaks: [{ quantity: 1, unitPrice: 0.5 }] }),
    ]);
    expect(offers.bestPriceAt(partId, 1, 'AUD')?.offer.distributor).toBe('digikey');
  });

  it('returns undefined when nothing qualifies', () => {
    expect(offers.bestPriceAt(partId, 1, 'EUR')).toBeUndefined();
    offers.replaceOffers(partId, 'digikey', [offer({ priceBreaks: [] })]);
    offers.replaceOffers(partId, 'mouser', []);
    expect(offers.bestPriceAt(partId, 1, 'AUD')).toBeUndefined();
  });
});
