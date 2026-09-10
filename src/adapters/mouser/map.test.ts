import { describe, expect, it } from 'vitest';

import { RECORDED_SLUGS, partNumberFixture } from '../../../test/helpers/mouser-fixtures.js';
import { ValidationError } from '../../core/validation-error.js';
import { MouserError } from './errors.js';
import {
  datasheetUrlOf,
  listingPackaging,
  packagingOf,
  parsePrice,
  siblingMpns,
  toOffer,
  unmappedAttributes,
  MAPPED_ATTRIBUTE_NAMES,
} from './map.js';
import { MouserSearchResponse, type MouserPart } from './schemas.js';

const CONTEXT = {
  fetchedAt: '2026-09-10T00:00:00Z',
  cacheKey: 'a'.repeat(64),
  fallbackCurrency: 'AUD' as const,
};

function part(slug: string): MouserPart {
  const parsed = MouserSearchResponse.parse(partNumberFixture(slug));
  const first = parsed.SearchResults?.Parts[0];
  if (first === undefined) {
    throw new Error(`fixture ${slug} has no part`);
  }
  return first;
}

describe('packagingOf', () => {
  it.each([
    ['Reel', 'reel'],
    ['MouseReel', 'reel'],
    ['Cut Tape', 'cut_tape'],
    ['Tube', 'tube'],
    ['Tray', 'tray'],
    ['Bulk', 'bulk'],
  ] as const)('maps %s to %s', (name, expected) => {
    expect(packagingOf(name)).toBe(expected);
  });

  it('prefers cut tape over reel and returns unknown for anything else', () => {
    expect(packagingOf('Cut Tape from Reel')).toBe('cut_tape');
    expect(packagingOf('Ammo')).toBe('unknown');
    expect(packagingOf('')).toBe('unknown');
  });

  it('covers every packaging value in the recorded fixtures', () => {
    expect(['Reel', 'Cut Tape', 'MouseReel', 'Tube'].map(packagingOf)).toEqual([
      'reel',
      'cut_tape',
      'reel',
      'tube',
    ]);
  });
});

describe('listingPackaging', () => {
  it('is unknown when a listing offers several packagings', () => {
    // Mouser sells one part number in several packagings under one SKU, so the
    // attribute says what you may choose rather than what you get.
    expect(listingPackaging(part('TPS54331DR'))).toBe('unknown');
  });

  it('is the packaging when a listing offers exactly one', () => {
    expect(listingPackaging(part('LT8610AEMSE-PBF'))).toBe('tube');
  });

  it('collapses values that mean the same packaging', () => {
    const base = part('LT8610AEMSE-PBF');
    const both: MouserPart = {
      ...base,
      ProductAttributes: [
        { AttributeName: 'Packaging', AttributeValue: 'Reel' },
        { AttributeName: 'Packaging', AttributeValue: 'MouseReel' },
      ],
    };

    expect(listingPackaging(both)).toBe('reel');
  });

  it('is unknown when a listing states no packaging', () => {
    expect(listingPackaging({ ...part('TPS54331DR'), ProductAttributes: [] })).toBe('unknown');
  });
});

describe('parsePrice', () => {
  it.each([
    ['$1.62', 1.62],
    ['$0.959', 0.959],
    ['$1,234.56', 1234.56],
    ['1,62 €', 1.62],
    ['1.234,56 €', 1234.56],
    ['2.36', 2.36],
    ['$0', 0],
  ])('reads %s as %s', (text, expected) => {
    expect(parsePrice(text, 'test')).toBe(expected);
  });

  it('refuses a price it cannot read rather than dropping the break', () => {
    expect(() => parsePrice('call for pricing', 'SKU-1')).toThrow(MouserError);
    expect(() => parsePrice('', 'SKU-1')).toThrow(MouserError);
    try {
      parsePrice('N/A', 'SKU-1');
    } catch (error) {
      expect((error as MouserError).code).toBe('MOUSER_RESPONSE_INVALID');
      expect((error as MouserError).details).toEqual({ price: 'N/A', context: 'SKU-1' });
    }
  });
});

describe('toOffer', () => {
  it('produces one validated offer per listing', () => {
    const offer = toOffer(part('TPS54331DR'), CONTEXT);

    expect(offer.distributor).toBe('mouser');
    expect(offer.sku).toBe('595-TPS54331DR');
    expect(offer.mpnAsListed).toBe('TPS54331DR');
    expect(offer.manufacturer).toBe('Texas Instruments');
    expect(offer.currency).toBe('USD');
    expect(offer.moq).toBe(1);
    expect(offer.stock).toBeGreaterThanOrEqual(0);
    expect(offer.provenance).toEqual({
      source: 'distributor',
      distributor: 'mouser',
      sku: '595-TPS54331DR',
      fetchedAt: CONTEXT.fetchedAt,
      cacheKey: CONTEXT.cacheKey,
    });
  });

  it('reads the formatted prices into numbers, sorted and increasing', () => {
    const offer = toOffer(part('TPS54331DR'), CONTEXT);
    const quantities = offer.priceBreaks.map((priceBreak) => priceBreak.quantity);

    expect(quantities).toEqual([...quantities].sort((a, b) => a - b));
    expect(new Set(quantities).size).toBe(quantities.length);
    expect(offer.priceBreaks[0]?.unitPrice).toBeGreaterThan(0);
    expect(offer.priceBreaks.every((priceBreak) => Number.isFinite(priceBreak.unitPrice))).toBe(
      true,
    );
  });

  it('names the fallback currency when a listing carries no prices', () => {
    const offer = toOffer({ ...part('TPS54331DR'), PriceBreaks: [] }, CONTEXT);

    expect(offer.currency).toBe('AUD');
    expect(offer.priceBreaks).toEqual([]);
  });

  it('drops a price break below quantity one', () => {
    const base = part('TPS54331DR');
    const odd: MouserPart = {
      ...base,
      PriceBreaks: [
        { Quantity: 0, Price: '$9.99', Currency: 'USD' },
        { Quantity: 1, Price: '$1.62', Currency: 'USD' },
      ],
    };

    expect(toOffer(odd, CONTEXT).priceBreaks).toEqual([{ quantity: 1, unitPrice: 1.62 }]);
  });

  it('treats missing or unreadable stock and minimum as zero and one', () => {
    const base = part('TPS54331DR');
    const sparse: MouserPart = { ...base, AvailabilityInStock: null, Min: null };

    const offer = toOffer(sparse, CONTEXT);

    expect(offer.stock).toBe(0);
    expect(offer.moq).toBe(1);
    expect(toOffer({ ...base, Min: 'call us' }, CONTEXT).moq).toBe(1);
    // A value that survives the digit filter but is not a number at all.
    expect(toOffer({ ...base, Min: '--' }, CONTEXT).moq).toBe(1);
    expect(toOffer({ ...base, AvailabilityInStock: '--' }, CONTEXT).stock).toBe(0);
    expect(toOffer({ ...base, AvailabilityInStock: '1,234' }, CONTEXT).stock).toBe(1234);
  });

  it('rejects a listing that cannot produce a valid offer', () => {
    expect(() => toOffer({ ...part('TPS54331DR'), Manufacturer: '' }, CONTEXT)).toThrow(
      ValidationError,
    );
  });

  it('works for every recorded part', () => {
    for (const slug of RECORDED_SLUGS) {
      const offer = toOffer(part(slug), CONTEXT);
      expect(offer.sku, slug).not.toBe('');
      expect(offer.moq, slug).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('datasheetUrlOf', () => {
  it('reads the link when Mouser has one', () => {
    expect(datasheetUrlOf(part('LT8610AEMSE-PBF'))).toContain('mouser.com/datasheet');
  });

  it('treats the empty string Mouser usually sends as absent', () => {
    expect(datasheetUrlOf(part('TPS54331DR'))).toBeUndefined();
    expect(datasheetUrlOf({ ...part('TPS54331DR'), DataSheetUrl: '   ' })).toBeUndefined();
  });
});

describe('siblingMpns', () => {
  it('lists the other packagings, trimmed and without the part itself', () => {
    const siblings = siblingMpns(part('TPS54331DR'));

    expect(siblings).toContain('TPS54331D');
    expect(siblings).toContain('TPS54331DG4');
    expect(siblings.every((mpn) => mpn === mpn.trim())).toBe(true);
    expect(siblings).not.toContain('TPS54331DR');
  });

  it('is empty when Mouser lists none', () => {
    expect(siblingMpns({ ...part('TPS54331DR'), AlternatePackagings: null })).toEqual([]);
    expect(
      siblingMpns({ ...part('TPS54331DR'), AlternatePackagings: [{ APMfrPN: '  ' }] }),
    ).toEqual([]);
  });

  it('de-duplicates repeats', () => {
    const repeated = {
      ...part('TPS54331DR'),
      AlternatePackagings: [{ APMfrPN: 'A' }, { APMfrPN: ' A' }, { APMfrPN: 'B' }],
    };

    expect(siblingMpns(repeated)).toEqual(['A', 'B']);
  });
});

describe('unmappedAttributes', () => {
  it('reports every attribute name, because none carries a schema parameter', () => {
    expect(MAPPED_ATTRIBUTE_NAMES).toEqual([]);
    expect(unmappedAttributes(part('TPS54331DR'))).toEqual(['Packaging', 'Standard Pack Qty']);
  });

  it('filters out names that are mapped', () => {
    expect(unmappedAttributes(part('TPS54331DR'), ['Packaging'])).toEqual(['Standard Pack Qty']);
    expect(unmappedAttributes(part('TPS54331DR'), ['Packaging', 'Standard Pack Qty'])).toEqual([]);
  });

  it('reports nothing for a listing with no attributes', () => {
    expect(unmappedAttributes({ ...part('TPS54331DR'), ProductAttributes: [] })).toEqual([]);
  });

  it('confirms across the corpus that Mouser returns no electrical parametrics', () => {
    const names = new Set<string>();
    for (const slug of RECORDED_SLUGS) {
      for (const name of unmappedAttributes(part(slug))) {
        names.add(name);
      }
    }

    expect([...names].sort()).toEqual(['Packaging', 'Standard Pack Qty']);
  });
});
