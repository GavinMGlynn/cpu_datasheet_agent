import { describe, expect, it } from 'vitest';

import { fixtureName, sanitiseFixture } from './fixtures.js';

describe('sanitiseFixture', () => {
  it('drops account-identifying keys at the top level', () => {
    expect(
      sanitiseFixture({ Product: { Name: 'x' }, AccountIdUsed: 12345, CustomerIdUsed: '678' }),
    ).toEqual({ Product: { Name: 'x' } });
  });

  it.each([
    'AccountIdUsed',
    'CustomerId',
    'customer_id',
    'access_token',
    'Token',
    'ClientId',
    'client-id',
    'apiKey',
    'API_KEY',
    'MySecret',
  ])('drops %s', (key) => {
    expect(sanitiseFixture({ [key]: 'sensitive', keep: 1 })).toEqual({ keep: 1 });
  });

  it('drops them at any depth, including inside arrays', () => {
    expect(
      sanitiseFixture({
        ProductPricings: [
          { Mpn: 'A', CustomerIdUsed: 1 },
          { Mpn: 'B', nested: { Token: 'z', ok: 2 } },
        ],
      }),
    ).toEqual({ ProductPricings: [{ Mpn: 'A' }, { Mpn: 'B', nested: { ok: 2 } }] });
  });

  it('keeps everything else exactly as it was', () => {
    const response = {
      Product: {
        ManufacturerProductNumber: 'TPS54331DR',
        Parameters: [{ ParameterText: 'Voltage - Input (Min)', ValueText: '3.5V' }],
        ProductVariations: [{ DigiKeyProductNumber: '296-26991-1-ND', StandardPricing: [] }],
      },
      SearchLocaleUsed: { Site: 'AU', Language: 'en', Currency: 'AUD' },
    };
    expect(sanitiseFixture(response)).toEqual(response);
  });

  it('passes primitives, null, and empty containers through', () => {
    expect(sanitiseFixture('text')).toBe('text');
    expect(sanitiseFixture(7)).toBe(7);
    expect(sanitiseFixture(null)).toBeNull();
    expect(sanitiseFixture(true)).toBe(true);
    expect(sanitiseFixture([])).toEqual([]);
    expect(sanitiseFixture({})).toEqual({});
  });

  it('does not mutate its input', () => {
    const input = { AccountIdUsed: 1, keep: { nested: 2 } };
    sanitiseFixture(input);
    expect(input).toEqual({ AccountIdUsed: 1, keep: { nested: 2 } });
  });
});

describe('fixtureName', () => {
  it.each([
    ['TPS54331DR', 'productdetails', 'TPS54331DR.productdetails.json'],
    ['LM2596S-5.0/NOPB', 'pricing', 'LM2596S-5-0-NOPB.pricing.json'],
    ['LT8610AEMSE#PBF', 'media', 'LT8610AEMSE-PBF.media.json'],
    ['mp1584en-lf-z', 'productdetails', 'MP1584EN-LF-Z.productdetails.json'],
    ['  spaced  ', 'keyword', 'SPACED.keyword.json'],
  ])('turns %s into a safe file name', (mpn, operation, expected) => {
    expect(fixtureName(mpn, operation)).toBe(expected);
  });

  it('produces no path separators for any part number', () => {
    expect(fixtureName('A/B\\C', 'op')).not.toMatch(/[/\\]/);
  });
});
