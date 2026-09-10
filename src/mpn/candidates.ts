import { datasheetUrlOf as digikeyDatasheetUrl, toOffers } from '../adapters/digikey/map.js';
import type { KeywordSearchResponse } from '../adapters/digikey/schemas.js';
import {
  datasheetUrlOf as mouserDatasheetUrl,
  siblingMpns,
  toOffer,
} from '../adapters/mouser/map.js';
import type { MouserSearchResponse } from '../adapters/mouser/schemas.js';
import type { Offer } from '../core/offer.js';
import type { Currency, Distributor } from '../core/primitives.js';
import { isChipAgentError } from '../errors.js';
import { decoderFor } from './decoders/index.js';
import { MpnError } from './errors.js';
import { normaliseMpn } from './normalise.js';
import type { DecodedMpn } from './types.js';

/** The shape of a cached, ledgered distributor response. */
export interface SearchResult<T> {
  readonly value: T;
  readonly cacheKey: string;
  readonly fetchedAt: string;
  readonly hit: boolean;
}

/**
 * The part of `DigiKeyApi` that candidate gathering uses.
 *
 * Structural, so a test needs a search function and a currency rather than a
 * client, a cache and a token store.
 */
export interface DigiKeyCandidateSource {
  readonly currency: Currency;
  searchKeyword(keywords: string, limit?: number): Promise<SearchResult<KeywordSearchResponse>>;
}

export interface MouserCandidateSource {
  readonly currency: Currency;
  searchKeyword(keyword: string, records?: number): Promise<SearchResult<MouserSearchResponse>>;
}

export interface CandidateSources {
  readonly digikey?: DigiKeyCandidateSource;
  readonly mouser?: MouserCandidateSource;
}

/** One distributor listing, with its part number decoded where possible. */
export interface MpnCandidate {
  readonly distributor: Distributor;
  /** The listed part number in canonical form. */
  readonly mpn: string;
  /** The listed part number exactly as the distributor spelled it. */
  readonly mpnAsListed: string;
  readonly manufacturer: string;
  readonly decoded: DecodedMpn | null;
  readonly datasheetUrl: string | undefined;
  readonly offers: readonly Offer[];
  /** Part numbers the distributor relates to this listing. */
  readonly siblings: readonly string[];
}

/** A listing that could not be used, and why. */
export interface CandidateSkip {
  readonly distributor: Distributor;
  readonly mpnAsListed: string;
  readonly reason: string;
}

export interface CandidateFailure {
  readonly distributor: Distributor;
  readonly code: string;
  readonly message: string;
}

export interface CandidateGathering {
  readonly query: string;
  readonly candidates: readonly MpnCandidate[];
  readonly skipped: readonly CandidateSkip[];
  /** A distributor that could not be reached or refused the request. */
  readonly failures: readonly CandidateFailure[];
}

export interface GatherOptions {
  /** Listings to ask each distributor for. */
  readonly limit?: number;
}

const DEFAULT_LIMIT = 10;

/**
 * A failure reduced to two fields for the record.
 *
 * Anything that is not one of this project's errors keeps whatever `String`
 * makes of it, prefix and all: the point is that a person reading the
 * gathering can tell what went wrong, not that it reads tidily.
 */
function describe(error: unknown): { code: string; message: string } {
  return isChipAgentError(error)
    ? { code: error.code, message: error.message }
    : { code: 'UNKNOWN', message: String(error) };
}

function decodeListing(mpn: string, manufacturer: string): DecodedMpn | null {
  return decoderFor(manufacturer)?.decode(mpn) ?? null;
}

async function digikeyCandidates(
  source: DigiKeyCandidateSource,
  query: string,
  limit: number,
  candidates: MpnCandidate[],
  skipped: CandidateSkip[],
): Promise<void> {
  const result = await source.searchKeyword(query, limit);
  // Exact matches first: Digi-Key returns them separately from the rest.
  const products = [...result.value.ExactMatches, ...result.value.Products];
  const seen = new Set<string>();
  for (const product of products) {
    const listed = product.ManufacturerProductNumber;
    const manufacturer = product.Manufacturer.Name;
    const key = `${manufacturer}/${listed}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    let mpn: string;
    try {
      mpn = normaliseMpn(listed).mpn;
    } catch (error) {
      skipped.push({ distributor: 'digikey', mpnAsListed: listed, reason: describe(error).code });
      continue;
    }
    const family = product.BaseProductNumber?.Name;
    candidates.push({
      distributor: 'digikey',
      mpn,
      mpnAsListed: listed,
      manufacturer,
      decoded: decodeListing(mpn, manufacturer),
      datasheetUrl: digikeyDatasheetUrl(product),
      offers: toOffers(product, {
        fetchedAt: result.fetchedAt,
        cacheKey: result.cacheKey,
        currency: source.currency,
      }),
      siblings: family === undefined ? [] : [family],
    });
  }
}

async function mouserCandidates(
  source: MouserCandidateSource,
  query: string,
  limit: number,
  candidates: MpnCandidate[],
  skipped: CandidateSkip[],
): Promise<void> {
  const result = await source.searchKeyword(query, limit);
  for (const part of result.value.SearchResults?.Parts ?? []) {
    const listed = part.ManufacturerPartNumber;
    let mpn: string;
    try {
      mpn = normaliseMpn(listed).mpn;
    } catch (error) {
      skipped.push({ distributor: 'mouser', mpnAsListed: listed, reason: describe(error).code });
      continue;
    }
    candidates.push({
      distributor: 'mouser',
      mpn,
      mpnAsListed: listed,
      manufacturer: part.Manufacturer,
      decoded: decodeListing(mpn, part.Manufacturer),
      datasheetUrl: mouserDatasheetUrl(part),
      offers: [
        toOffer(part, {
          fetchedAt: result.fetchedAt,
          cacheKey: result.cacheKey,
          fallbackCurrency: source.currency,
        }),
      ],
      siblings: siblingMpns(part),
    });
  }
}

/**
 * Every listing both distributors return for a part number, decoded.
 *
 * A distributor that fails is recorded rather than thrown, so one being down
 * does not lose what the other found. When every distributor that was asked
 * failed and nothing came back, the failure is raised as `MPN_LOOKUP_FAILED`:
 * no listings and no working source is a broken lookup, not a part that does
 * not exist.
 */
export async function gatherCandidates(
  sources: CandidateSources,
  query: string,
  options: GatherOptions = {},
): Promise<CandidateGathering> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const candidates: MpnCandidate[] = [];
  const skipped: CandidateSkip[] = [];
  const failures: CandidateFailure[] = [];

  if (sources.digikey !== undefined) {
    try {
      await digikeyCandidates(sources.digikey, query, limit, candidates, skipped);
    } catch (error) {
      failures.push({ distributor: 'digikey', ...describe(error) });
    }
  }
  if (sources.mouser !== undefined) {
    try {
      await mouserCandidates(sources.mouser, query, limit, candidates, skipped);
    } catch (error) {
      failures.push({ distributor: 'mouser', ...describe(error) });
    }
  }
  if (candidates.length === 0 && failures.length > 0) {
    throw new MpnError('MPN_LOOKUP_FAILED', `no distributor could be asked about ${query}`, {
      details: { query, failures },
    });
  }
  return { query, candidates, skipped, failures };
}
