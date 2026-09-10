import { Offer, selectBestPrice, type BestPrice } from '../core/offer.js';
import type { Currency, Distributor } from '../core/primitives.js';
import { parseOrThrow } from '../core/validation-error.js';
import { DbError, type Db } from './database.js';
import { parseJson } from './json.js';

interface OfferRow {
  id: number;
  distributor: string;
  sku: string;
  manufacturer: string;
  mpn_as_listed: string;
  currency: string;
  stock: number;
  moq: number;
  packaging: string;
  fetched_at: string;
  provenance_json: string;
}

interface BreakRow {
  quantity: number;
  unit_price: number;
}

export class OfferRepository {
  constructor(private readonly db: Db) {}

  /** Replaces one distributor's offers for a part atomically. Every offer must belong to that distributor. */
  replaceOffers(partId: number, distributor: Distributor, inputs: readonly unknown[]): Offer[] {
    const offers = inputs.map((input, index) =>
      parseOrThrow(Offer, input, `Offer[${String(index)}]`),
    );
    for (const offer of offers) {
      if (offer.distributor !== distributor) {
        throw new DbError(
          'DB_OFFER_DISTRIBUTOR_MISMATCH',
          `offer ${offer.sku} is from ${offer.distributor}, not ${distributor}`,
          {
            details: { sku: offer.sku, expected: distributor, actual: offer.distributor },
          },
        );
      }
    }
    this.db.transaction(() => {
      this.db.raw
        .prepare<[number, string]>('DELETE FROM offers WHERE part_id = ? AND distributor = ?')
        .run(partId, distributor);
      this.insertAll(partId, offers);
    });
    return this.getOffers(partId).filter((offer) => offer.distributor === distributor);
  }

  /** Replaces every offer for a part. Used by the part aggregate upsert. */
  replaceAllOffers(partId: number, offers: readonly Offer[]): void {
    this.db.raw.prepare<[number]>('DELETE FROM offers WHERE part_id = ?').run(partId);
    this.insertAll(partId, offers);
  }

  private insertAll(partId: number, offers: readonly Offer[]): void {
    const insertOffer = this.db.raw.prepare<
      [number, string, string, string, string, string, number, number, string, string, string]
    >(
      `INSERT INTO offers (part_id, distributor, sku, manufacturer, mpn_as_listed, currency, stock, moq, packaging, fetched_at, provenance_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertBreak = this.db.raw.prepare<[number, number, number]>(
      'INSERT INTO price_breaks (offer_id, quantity, unit_price) VALUES (?, ?, ?)',
    );
    for (const offer of offers) {
      const result = insertOffer.run(
        partId,
        offer.distributor,
        offer.sku,
        offer.manufacturer,
        offer.mpnAsListed,
        offer.currency,
        offer.stock,
        offer.moq,
        offer.packaging,
        offer.fetchedAt,
        JSON.stringify(offer.provenance),
      );
      const offerId = Number(result.lastInsertRowid);
      for (const priceBreak of offer.priceBreaks) {
        insertBreak.run(offerId, priceBreak.quantity, priceBreak.unitPrice);
      }
    }
  }

  getOffers(partId: number): Offer[] {
    const rows = this.db.raw
      .prepare<[number], OfferRow>(
        `SELECT id, distributor, sku, manufacturer, mpn_as_listed, currency, stock, moq, packaging, fetched_at, provenance_json
         FROM offers WHERE part_id = ? ORDER BY distributor, sku`,
      )
      .all(partId);
    const breaks = this.db.raw.prepare<[number], BreakRow>(
      'SELECT quantity, unit_price FROM price_breaks WHERE offer_id = ? ORDER BY quantity',
    );
    return rows.map((row) =>
      parseOrThrow(
        Offer,
        {
          distributor: row.distributor,
          sku: row.sku,
          manufacturer: row.manufacturer,
          mpnAsListed: row.mpn_as_listed,
          currency: row.currency,
          priceBreaks: breaks
            .all(row.id)
            .map((b) => ({ quantity: b.quantity, unitPrice: b.unit_price })),
          stock: row.stock,
          moq: row.moq,
          packaging: row.packaging,
          fetchedAt: row.fetched_at,
          provenance: parseJson(row.provenance_json),
        },
        `stored Offer ${row.distributor}:${row.sku}`,
      ),
    );
  }

  /**
   * Cheapest unit price for buying `quantity` of a part in `currency`,
   * considering only offers whose MOQ is met and applying the highest price
   * break at or below the quantity. Undefined when no offer qualifies.
   */
  bestPriceAt(partId: number, quantity: number, currency: Currency): BestPrice | undefined {
    return selectBestPrice(this.getOffers(partId), quantity, currency);
  }
}
