import { describe, it } from 'vitest';

import { distributorProvenance, offer, priceBreaks } from '../../test/helpers/core-fixtures.js';
import { expectAccepts, expectRejects } from '../../test/helpers/schema.js';
import { Offer, PACKAGINGS, Packaging, PriceBreak } from './offer.js';

describe('Packaging', () => {
  it.each(PACKAGINGS)('accepts %s', (value) => {
    expectAccepts(Packaging, value);
  });

  it('rejects unknown packaging', () => {
    expectRejects(Packaging, 'Tape & Reel');
  });
});

describe('PriceBreak', () => {
  it('accepts a positive quantity and a non-negative price', () => {
    expectAccepts(PriceBreak, { quantity: 1, unitPrice: 0 });
    expectAccepts(PriceBreak, { quantity: 1000, unitPrice: 0.123456 });
  });

  it.each([
    ['quantity 0', { quantity: 0, unitPrice: 1 }],
    ['a fractional quantity', { quantity: 1.5, unitPrice: 1 }],
    ['a negative price', { quantity: 1, unitPrice: -0.01 }],
    ['a price as text', { quantity: 1, unitPrice: '1.00' }],
    ['a currency inside the break', { quantity: 1, unitPrice: 1, currency: 'AUD' }],
  ])('rejects %s', (_label, value) => {
    expectRejects(PriceBreak, value);
  });
});

describe('Offer', () => {
  it('accepts the fixture offer, an offer with no price breaks, and one with a single break', () => {
    expectAccepts(Offer, offer());
    expectAccepts(Offer, offer({ priceBreaks: [] }));
    expectAccepts(Offer, offer({ priceBreaks: [{ quantity: 1, unitPrice: 2 }] }));
  });

  it('accepts a Mouser offer with matching provenance', () => {
    expectAccepts(
      Offer,
      offer({
        distributor: 'mouser',
        sku: '595-TPS54331DR',
        provenance: distributorProvenance({ distributor: 'mouser', sku: '595-TPS54331DR' }),
      }),
    );
  });

  it('rejects price breaks that are not strictly increasing in quantity', () => {
    const [first, second, third] = priceBreaks();
    expectRejects(Offer, offer({ priceBreaks: [second, first, third] }), 'priceBreaks.1.quantity');
    expectRejects(Offer, offer({ priceBreaks: [first, first] }), 'priceBreaks.1.quantity');
  });

  it('rejects provenance that names a different distributor or sku', () => {
    expectRejects(
      Offer,
      offer({ provenance: distributorProvenance({ distributor: 'mouser' }) }),
      'provenance.distributor',
    );
    expectRejects(
      Offer,
      offer({ provenance: distributorProvenance({ sku: 'other' }) }),
      'provenance.sku',
    );
  });

  it.each([
    [
      'a non-distributor provenance',
      offer({ provenance: { source: 'human', note: 'x', recordedAt: '2026-09-10T00:00:00Z' } }),
    ],
    ['an unknown currency', offer({ currency: 'XXX' })],
    ['negative stock', offer({ stock: -1 })],
    ['moq 0', offer({ moq: 0 })],
    ['stock as text', offer({ stock: '12000' })],
    ['an unknown packaging', offer({ packaging: 'ammo' })],
    ['an empty sku', offer({ sku: '' })],
    ['an extra key', offer({ leadTime: 12 })],
    [
      'a missing fetchedAt',
      (() => {
        const { fetchedAt: _at, ...rest } = offer();
        return rest;
      })(),
    ],
  ])('rejects %s', (_label, value) => {
    expectRejects(Offer, value);
  });
});
