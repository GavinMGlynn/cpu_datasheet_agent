import { jsonCodec, type Cache } from '../../cache/index.js';
import type { Offer } from '../../core/offer.js';
import type { Currency } from '../../core/primitives.js';
import type { ToolCallLedger } from '../../log/index.js';
import { SEARCH_BASE, assertNoApiErrors, type MouserClient } from './client.js';
import { MouserError } from './errors.js';
import { datasheetUrlOf, siblingMpns, toOffer, unmappedAttributes } from './map.js';
import { MouserSearchResponse, type MouserPart } from './schemas.js';

/** Bumped when a request shape changes, so old cached responses are not reused. */
export const MOUSER_REQUEST_VERSION = 1;

export const OPERATIONS = {
  searchPartNumber: 'mouser_search_part_number',
  searchKeyword: 'mouser_search_keyword',
} as const;
export type OperationName = keyof typeof OPERATIONS;

/** Pricing and stock move daily; both operations return both. */
export const DEFAULT_TTL_SECONDS = 86_400;

export interface MouserResult<T> {
  readonly value: T;
  readonly hit: boolean;
  readonly cacheKey: string;
  readonly fetchedAt: string;
}

export interface MouserApiOptions {
  readonly client: MouserClient;
  readonly cache: Cache;
  /** Named on offers that carry no price breaks of their own. */
  readonly fallbackCurrency: Currency;
  readonly ledger?: ToolCallLedger;
  readonly ttlSeconds?: number;
  readonly force?: boolean;
}

export interface PartLookup {
  readonly mpn: string;
  readonly manufacturer: string;
  readonly offer: Offer;
  /** Empty for every switching regulator checked. Mouser is not a datasheet source in practice. */
  readonly datasheetUrl: string | undefined;
  /** Part numbers Mouser lists as other packagings of the same part. */
  readonly siblings: readonly string[];
  /** Attribute names carrying no schema parameter, reported rather than dropped. */
  readonly unmapped: readonly string[];
  readonly part: MouserPart;
  readonly hit: boolean;
}

/**
 * Mouser Search API operations.
 *
 * Mouser is a second opinion on price and availability, not a source of
 * parameters: its Search API returns only packaging attributes for switching
 * regulators. Every call goes through the cache and the ledger.
 */
export class MouserApi {
  constructor(private readonly options: MouserApiOptions) {}

  /** Exact part-number search. Returns the response even when it found nothing. */
  searchPartNumber(mpn: string): Promise<MouserResult<MouserSearchResponse>> {
    return this.run('searchPartNumber', { mpn }, async () => {
      const response = await this.options.client.request(MouserSearchResponse, {
        path: `${SEARCH_BASE}/partnumber`,
        body: { SearchByPartRequest: { mouserPartNumber: mpn, partSearchOptions: 'Exact' } },
      });
      assertNoApiErrors(response.Errors, `${SEARCH_BASE}/partnumber`);
      return response;
    });
  }

  searchKeyword(keyword: string, records = 10): Promise<MouserResult<MouserSearchResponse>> {
    return this.run('searchKeyword', { keyword, records }, async () => {
      const response = await this.options.client.request(MouserSearchResponse, {
        path: `${SEARCH_BASE}/keyword`,
        body: { SearchByKeywordRequest: { keyword, records, startingRecord: 0 } },
      });
      assertNoApiErrors(response.Errors, `${SEARCH_BASE}/keyword`);
      return response;
    });
  }

  /**
   * The offer, siblings, and datasheet link for one part number.
   *
   * Throws `MOUSER_NOT_FOUND` when Mouser does not list the part, which is a
   * fact about the part rather than a failure of the call.
   */
  async lookup(mpn: string): Promise<PartLookup> {
    const result = await this.searchPartNumber(mpn);
    const part = result.value.SearchResults?.Parts[0];
    if (part === undefined) {
      throw new MouserError('MOUSER_NOT_FOUND', `Mouser does not list ${mpn}`, {
        details: { mpn },
      });
    }
    return {
      mpn: part.ManufacturerPartNumber,
      manufacturer: part.Manufacturer,
      offer: toOffer(part, {
        fetchedAt: result.fetchedAt,
        cacheKey: result.cacheKey,
        fallbackCurrency: this.options.fallbackCurrency,
      }),
      datasheetUrl: datasheetUrlOf(part),
      siblings: siblingMpns(part),
      unmapped: unmappedAttributes(part),
      part,
      hit: result.hit,
    };
  }

  private async run<T>(
    operation: OperationName,
    params: Record<string, unknown>,
    fetch: () => Promise<T>,
  ): Promise<MouserResult<T>> {
    const tool = OPERATIONS[operation];
    const ledger = this.options.ledger;
    const callId = ledger?.begin(tool, params, { spendsQuota: true });

    try {
      const cached = await this.options.cache.cached(
        { namespace: tool, params: { ...params, version: MOUSER_REQUEST_VERSION } },
        async () => ({ value: await fetch() }),
        {
          codec: jsonCodec<T>(),
          ttlSeconds: this.options.ttlSeconds ?? DEFAULT_TTL_SECONDS,
          ...(this.options.force === undefined ? {} : { force: this.options.force }),
        },
      );
      const result: MouserResult<T> = {
        value: cached.value,
        hit: cached.hit,
        cacheKey: cached.hash,
        fetchedAt: cached.meta.createdAt,
      };
      if (ledger !== undefined && callId !== undefined) {
        await ledger.end(callId, {
          output: { hit: result.hit, cacheKey: result.cacheKey, fetchedAt: result.fetchedAt },
        });
      }
      return result;
    } catch (error) {
      if (ledger !== undefined && callId !== undefined) {
        await ledger.end(callId, { error });
      }
      throw error;
    }
  }
}
