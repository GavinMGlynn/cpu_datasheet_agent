import { z } from 'zod';

/** Part number exactly as a source gave it, with surrounding whitespace removed. */
export const RawMpn = z.string().trim().min(1).max(64);
export type RawMpn = z.output<typeof RawMpn>;

/** Canonical part number: uppercase, no whitespace. Produced by the MPN module. */
export const NormalisedMpn = z.string().regex(/^[A-Z0-9][A-Z0-9./+#-]{0,63}$/, {
  error: 'expected an uppercase part number with no whitespace (letters, digits, - . / + #)',
});
export type NormalisedMpn = z.output<typeof NormalisedMpn>;

export const ManufacturerName = z.string().trim().min(1).max(128);
export type ManufacturerName = z.output<typeof ManufacturerName>;

export const Sha256 = z
  .string()
  .regex(/^[a-f0-9]{64}$/, { error: 'expected a lowercase hexadecimal SHA-256 digest' });
export type Sha256 = z.output<typeof Sha256>;

/** UTC timestamp, RFC 3339 profile, always ending in `Z`. */
export const Iso8601 = z.iso.datetime({ error: 'expected an ISO 8601 UTC timestamp ending in Z' });
export type Iso8601 = z.output<typeof Iso8601>;

export const Url = z.url({
  protocol: /^https?$/,
  error: 'expected an absolute http or https URL',
});
export type Url = z.output<typeof Url>;

/** 1-based page number in a PDF. */
export const PageNumber = z.number().int().positive();
export type PageNumber = z.output<typeof PageNumber>;

export const CURRENCIES = [
  'AUD',
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CNY',
  'CAD',
  'SGD',
  'NZD',
  'HKD',
  'KRW',
  'TWD',
  'INR',
  'CHF',
  'SEK',
  'DKK',
  'NOK',
  'PLN',
  'CZK',
  'MXN',
] as const;
export const Currency = z.enum(CURRENCIES);
export type Currency = z.output<typeof Currency>;

export const Percent = z.number().min(0).max(100);
export type Percent = z.output<typeof Percent>;

export const Celsius = z.number().min(-273.15).max(1000);
export type Celsius = z.output<typeof Celsius>;

export const DISTRIBUTORS = ['digikey', 'mouser', 'nexar'] as const;
export const Distributor = z.enum(DISTRIBUTORS);
export type Distributor = z.output<typeof Distributor>;
