import { describe, expect, it } from 'vitest';

import { loadFixture, productDetails } from '../../../test/helpers/digikey-fixtures.js';
import { ValidationError } from '../../core/validation-error.js';
import {
  datasheetUrlFromMedia,
  datasheetUrlOf,
  packagingOf,
  parametricFacts,
  toOffers,
} from './map.js';
import { MediaResponse, ProductDetailsResponse, type DigiKeyProduct } from './schemas.js';

const CONTEXT = {
  fetchedAt: '2026-09-10T00:00:00Z',
  cacheKey: 'a'.repeat(64),
  currency: 'AUD' as const,
};

function product(slug: string): DigiKeyProduct {
  return ProductDetailsResponse.parse(productDetails(slug)).Product;
}

describe('packagingOf', () => {
  it.each([
    ['Cut Tape (CT)', 'cut_tape'],
    ['Tape & Reel (TR)', 'reel'],
    ['Tape and Reel', 'reel'],
    ['Digi-Reel®', 'reel'],
    ['DigiReel', 'reel'],
    ['Tube', 'tube'],
    ['Tray', 'tray'],
    ['Bulk', 'bulk'],
    ['Box', 'bulk'],
    ['Strip', 'bulk'],
  ] as const)('maps %s to %s', (name, expected) => {
    expect(packagingOf(name)).toBe(expected);
  });

  it('prefers cut tape over reel when a name mentions both', () => {
    expect(packagingOf('Cut Tape (CT) from Tape & Reel')).toBe('cut_tape');
  });

  it('returns unknown for an unrecognised or absent name', () => {
    expect(packagingOf('Ammo Pack')).toBe('unknown');
    expect(packagingOf(undefined)).toBe('unknown');
    expect(packagingOf('')).toBe('unknown');
  });

  it('covers every packaging name in the recorded fixtures', () => {
    const seen = ['Cut Tape (CT)', 'Digi-Reel®', 'Tape & Reel (TR)', 'Tube'];
    expect(seen.map((name) => packagingOf(name))).toEqual(['cut_tape', 'reel', 'reel', 'tube']);
  });
});

describe('toOffers', () => {
  it('produces one validated offer per packaging variant', () => {
    const offers = toOffers(product('TPS54331DR'), CONTEXT);

    expect(offers).toHaveLength(3);
    expect(offers.map((offer) => offer.packaging).sort()).toEqual(['cut_tape', 'reel', 'reel']);
    for (const offer of offers) {
      expect(offer.distributor).toBe('digikey');
      expect(offer.mpnAsListed).toBe('TPS54331DR');
      expect(offer.manufacturer).toBe('Texas Instruments');
      expect(offer.currency).toBe('AUD');
      expect(offer.sku).toMatch(/-ND$/);
      expect(offer.provenance).toEqual({
        source: 'distributor',
        distributor: 'digikey',
        sku: offer.sku,
        fetchedAt: CONTEXT.fetchedAt,
        cacheKey: CONTEXT.cacheKey,
      });
    }
  });

  it('keeps price breaks sorted and strictly increasing', () => {
    for (const offer of toOffers(product('TPS54331DR'), CONTEXT)) {
      const quantities = offer.priceBreaks.map((priceBreak) => priceBreak.quantity);
      expect(quantities).toEqual([...quantities].sort((a, b) => a - b));
      expect(new Set(quantities).size).toBe(quantities.length);
      expect(quantities.every((quantity) => quantity >= 1)).toBe(true);
    }
  });

  it('carries the reel minimum order quantity through', () => {
    const reel = toOffers(product('TPS54331DR'), CONTEXT).find((offer) =>
      offer.sku.endsWith('-2-ND'),
    );

    expect(reel?.moq).toBeGreaterThan(1);
    expect(reel?.packaging).toBe('reel');
  });

  it('works for every recorded part', () => {
    for (const slug of [
      'MP1584EN-LF-Z',
      'AP63203WU-7',
      'TPS563200DDCR',
      'LM5164DDAR',
      'ST1S10PHR',
    ]) {
      const offers = toOffers(product(slug), CONTEXT);
      expect(offers.length).toBeGreaterThan(0);
      expect(offers.every((offer) => offer.stock >= 0 && offer.moq >= 1)).toBe(true);
    }
  });

  it('excludes marketplace listings unless asked for them', () => {
    const base = product('TPS54331DR');
    const withMarketplace: DigiKeyProduct = {
      ...base,
      ProductVariations: [
        ...base.ProductVariations,
        {
          DigiKeyProductNumber: 'MP-1-ND',
          PackageType: { Name: 'Tube' },
          StandardPricing: [{ BreakQuantity: 1, UnitPrice: 9, TotalPrice: 9 }],
          MinimumOrderQuantity: 1,
          QuantityAvailableforPackageType: 5,
          MarketPlace: true,
        },
      ],
    };

    expect(toOffers(withMarketplace, CONTEXT)).toHaveLength(3);
    expect(toOffers(withMarketplace, { ...CONTEXT, includeMarketplace: true })).toHaveLength(4);
  });

  it('drops price breaks below quantity one and de-duplicates repeats', () => {
    const base = product('TPS54331DR');
    const odd: DigiKeyProduct = {
      ...base,
      ProductVariations: [
        {
          DigiKeyProductNumber: 'ODD-ND',
          PackageType: { Name: 'Tube' },
          StandardPricing: [
            { BreakQuantity: 0, UnitPrice: 5, TotalPrice: 0 },
            { BreakQuantity: 10, UnitPrice: 2, TotalPrice: 20 },
            { BreakQuantity: 1, UnitPrice: 3, TotalPrice: 3 },
            { BreakQuantity: 10, UnitPrice: 1.9, TotalPrice: 19 },
          ],
        },
      ],
    };

    const [offer] = toOffers(odd, CONTEXT);

    expect(offer?.priceBreaks).toEqual([
      { quantity: 1, unitPrice: 3 },
      { quantity: 10, unitPrice: 1.9 },
    ]);
    expect(offer?.moq).toBe(1);
    expect(offer?.stock).toBe(product('TPS54331DR').QuantityAvailable);
  });

  it('reports zero stock when neither the variation nor the product states any', () => {
    const base = product('TPS54331DR');
    const { QuantityAvailable: _quantity, ...withoutQuantity } = base;
    const stockless: DigiKeyProduct = {
      ...withoutQuantity,
      ProductVariations: [
        { DigiKeyProductNumber: 'NO-STOCK-ND', PackageType: { Name: 'Tube' }, StandardPricing: [] },
      ],
    };

    expect(toOffers(stockless, CONTEXT)[0]?.stock).toBe(0);
  });

  it('rejects a variation that cannot produce a valid offer', () => {
    const base = product('TPS54331DR');
    const broken: DigiKeyProduct = {
      ...base,
      Manufacturer: { Name: '' },
      ProductVariations: [{ DigiKeyProductNumber: 'X-ND', StandardPricing: [] }],
    };

    expect(() => toOffers(broken, CONTEXT)).toThrow(ValidationError);
  });
});

describe('datasheet URLs', () => {
  it('reads the product datasheet URL', () => {
    expect(datasheetUrlOf(product('TPS54331DR'))).toContain('ti.com');
  });

  it('treats a missing or blank URL as absent', () => {
    const base = product('TPS54331DR');
    const { DatasheetUrl: _url, ...withoutUrl } = base;
    expect(datasheetUrlOf(withoutUrl)).toBeUndefined();
    expect(datasheetUrlOf({ ...base, DatasheetUrl: '   ' })).toBeUndefined();
  });

  it('finds the datasheet among the media links', () => {
    const media = MediaResponse.parse(loadFixture('TPS54331DR.media.json'));

    expect(datasheetUrlFromMedia(media)).toContain('ti.com');
  });

  it('returns undefined when the media has no datasheet', () => {
    expect(
      datasheetUrlFromMedia({
        MediaLinks: [{ MediaType: 'Product Photos', Url: 'https://x/y.jpg' }],
      }),
    ).toBeUndefined();
  });
});

describe('parametricFacts', () => {
  it('maps the parametrics of a real part into schema-keyed facts', () => {
    const { facts, failures } = parametricFacts(product('TPS54331DR'));
    const byKey = new Map(facts.map((fact) => [fact.key, fact.value]));

    expect(failures).toEqual([]);
    expect(byKey.get('vinMin')).toEqual({ value: 3.5, unit: 'V' });
    expect(byKey.get('vinMax')).toEqual({ value: 28, unit: 'V' });
    expect(byKey.get('ioutMax')).toEqual({ value: 3, unit: 'A' });
    expect(byKey.get('switchingFrequency')).toEqual({ value: 570_000, unit: 'Hz' });
    expect(byKey.get('topology')).toBe('non_synchronous');
    expect(byKey.get('operatingTempMin')).toEqual({ value: -40, unit: 'degC' });
    expect(byKey.get('operatingTempMax')).toEqual({ value: 150, unit: 'degC' });
    expect(byKey.get('temperatureReference')).toBe('junction');
    expect(byKey.get('package')).toContain('SOIC');
  });

  it('reports names that carry no schema parameter rather than dropping them', () => {
    const { unmapped } = parametricFacts(product('TPS54331DR'));

    expect(unmapped).toEqual(
      expect.arrayContaining([
        'Function',
        'Output Configuration',
        'Topology',
        'Number of Outputs',
        'Mounting Type',
      ]),
    );
  });

  it('reads a synchronous part and an ambient temperature reference', () => {
    const { facts } = parametricFacts(product('AP63203WU-7'));
    const byKey = new Map(facts.map((fact) => [fact.key, fact.value]));

    expect(byKey.get('topology')).toBe('synchronous');
    expect(byKey.get('temperatureReference')).toBe('ambient');
  });

  it('yields nothing for a parameter Digi-Key reports as not applicable', () => {
    const withDash: DigiKeyProduct = {
      ...product('TPS54331DR'),
      Parameters: [{ ParameterText: 'Voltage - Output (Max)', ValueText: '-' }],
    };

    expect(parametricFacts(withDash).facts).toEqual([]);
  });

  it('reports a value it cannot parse instead of guessing', () => {
    const nonsense: DigiKeyProduct = {
      ...product('TPS54331DR'),
      Parameters: [{ ParameterText: 'Voltage - Input (Min)', ValueText: 'about five volts' }],
    };

    const { facts, failures } = parametricFacts(nonsense);

    expect(facts).toEqual([]);
    expect(failures).toEqual([
      {
        name: 'Voltage - Input (Min)',
        value: 'about five volts',
        reason: expect.stringContaining('cannot parse') as string,
      },
    ]);
  });

  it('parses every recorded part without a failure', () => {
    for (const slug of [
      'TPS54331DR',
      'MP1584EN-LF-Z',
      'AP63203WU-7',
      'TPS563200DDCR',
      'TPS62130RGTR',
      'TLV62569DBVR',
      'LMR33630ADDAR',
      'LM5164DDAR',
      'TPS54560BDDAR',
      'MP2315GJ-Z',
      'LT8610AEMSE-PBF',
      'NCP3170ADR2G',
      'ST1S10PHR',
    ]) {
      const { failures, facts } = parametricFacts(product(slug));
      expect(failures, `${slug} produced parse failures`).toEqual([]);
      expect(facts.length, `${slug} produced no facts`).toBeGreaterThan(4);
    }
  });
});
