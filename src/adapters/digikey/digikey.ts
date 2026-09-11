import { jsonCodec, type Cache } from '../../cache/index.js';
import type { Currency } from '../../core/primitives.js';
import type { Offer } from '../../core/offer.js';
import type { ToolCallLedger } from '../../log/index.js';
import type { DistributorFact } from '../../units/index.js';
import type { DigiKeyClient, DigiKeyLocale } from './client.js';
import {
  datasheetUrlFromMedia,
  datasheetUrlOf,
  parametricFacts,
  toOffers,
  type ParametricFailure,
} from './map.js';
import {
  AlternatePackagingResponse,
  KeywordSearchResponse,
  MediaResponse,
  PricingResponse,
  ProductDetailsResponse,
  SubstitutionsResponse,
  type DigiKeyProduct,
} from './schemas.js';

/** Bumped when a request shape changes, so old cached responses are not reused. */
export const DIGIKEY_REQUEST_VERSION = 1;

export const SEARCH_BASE = '/products/v4/search';

/** Cache namespace and ledger tool name for each operation. */
export const OPERATIONS = {
  keywordSearch: 'digikey_keyword_search',
  productDetails: 'digikey_product_details',
  pricing: 'digikey_pricing',
  media: 'digikey_media',
  substitutions: 'digikey_substitutions',
  alternatePackaging: 'digikey_alternate_packaging',
} as const;
export type OperationName = keyof typeof OPERATIONS;

/** Defaults chosen by how fast the data moves: pricing daily, descriptive weekly. */
export const DEFAULT_TTL_SECONDS: Readonly<Record<OperationName, number>> = Object.freeze({
  keywordSearch: 86_400,
  productDetails: 86_400,
  pricing: 86_400,
  media: 604_800,
  substitutions: 604_800,
  alternatePackaging: 604_800,
});

export interface DigiKeyResult<T> {
  readonly value: T;
  /** True when served from the cache, meaning no quota was spent. */
  readonly hit: boolean;
  /** Hash of the cache key, recorded as provenance on anything derived from this response. */
  readonly cacheKey: string;
  readonly fetchedAt: string;
}

export interface DigiKeyApiOptions {
  readonly client: DigiKeyClient;
  readonly cache: Cache;
  readonly locale: DigiKeyLocale;
  readonly sandbox?: boolean;
  readonly ledger?: ToolCallLedger;
  readonly ttlSeconds?: Partial<Record<OperationName, number>>;
  /** Bypass the cache and refetch. Spends quota on every call. */
  readonly force?: boolean;
  /**
   * Answer from the cache or fail with `CACHE_MISS`. This is how a caller
   * asks for the answer only if it is free, running the same key path the
   * spending call runs.
   */
  readonly cacheOnly?: boolean;
}

export interface PartLookup {
  readonly mpn: string;
  readonly manufacturer: string;
  readonly offers: readonly Offer[];
  readonly datasheetUrl: string | undefined;
  readonly facts: readonly DistributorFact[];
  /** Parametric names with no mapping, so the mapping table can be extended. */
  readonly unmapped: readonly string[];
  readonly failures: readonly ParametricFailure[];
  /** The family part number, when Digi-Key reports one. */
  readonly baseProductNumber: string | undefined;
  /** Provenance for anything read out of this response. */
  readonly cacheKey: string;
  readonly fetchedAt: string;
  readonly product: DigiKeyProduct;
  readonly hit: boolean;
}

/**
 * Digi-Key Product Information v4 operations.
 *
 * Every call goes through the cache first, so a rerun spends no quota, and
 * through the ledger, so the eval dataset records what was asked and what came
 * back. The cache key includes the locale and the environment, because a
 * sandbox response and a production response are different answers to the same
 * question.
 */
export class DigiKeyApi {
  constructor(private readonly options: DigiKeyApiOptions) {}

  get currency(): Currency {
    return this.options.locale.currency as Currency;
  }

  /**
   * The same API with some options changed, sharing the client, cache and
   * ledger. Used to run one call under `cacheOnly` without building a second
   * client or duplicating how a cache key is made.
   */
  withOptions(overrides: Partial<DigiKeyApiOptions>): DigiKeyApi {
    return new DigiKeyApi({ ...this.options, ...overrides });
  }

  searchKeyword(keywords: string, limit = 10): Promise<DigiKeyResult<KeywordSearchResponse>> {
    return this.run('keywordSearch', { keywords, limit }, () =>
      this.options.client.request(KeywordSearchResponse, {
        method: 'POST',
        path: `${SEARCH_BASE}/keyword`,
        body: { Keywords: keywords, Limit: limit, Offset: 0 },
      }),
    );
  }

  productDetails(mpn: string): Promise<DigiKeyResult<ProductDetailsResponse>> {
    return this.run('productDetails', { mpn }, () =>
      this.options.client.request(ProductDetailsResponse, {
        method: 'GET',
        path: `${SEARCH_BASE}/${encodeURIComponent(mpn)}/productdetails`,
      }),
    );
  }

  pricing(mpn: string): Promise<DigiKeyResult<PricingResponse>> {
    return this.run('pricing', { mpn }, () =>
      this.options.client.request(PricingResponse, {
        method: 'GET',
        path: `${SEARCH_BASE}/${encodeURIComponent(mpn)}/pricing`,
      }),
    );
  }

  media(mpn: string): Promise<DigiKeyResult<MediaResponse>> {
    return this.run('media', { mpn }, () =>
      this.options.client.request(MediaResponse, {
        method: 'GET',
        path: `${SEARCH_BASE}/${encodeURIComponent(mpn)}/media`,
      }),
    );
  }

  substitutions(mpn: string): Promise<DigiKeyResult<SubstitutionsResponse>> {
    return this.run('substitutions', { mpn }, () =>
      this.options.client.request(SubstitutionsResponse, {
        method: 'GET',
        path: `${SEARCH_BASE}/${encodeURIComponent(mpn)}/substitutions`,
      }),
    );
  }

  alternatePackaging(mpn: string): Promise<DigiKeyResult<AlternatePackagingResponse>> {
    return this.run('alternatePackaging', { mpn }, () =>
      this.options.client.request(AlternatePackagingResponse, {
        method: 'GET',
        path: `${SEARCH_BASE}/${encodeURIComponent(mpn)}/alternatepackaging`,
      }),
    );
  }

  /**
   * One call that yields everything the pipeline needs from Digi-Key: offers
   * per packaging variant, the datasheet URL, and the parametric facts.
   *
   * Product details already carries pricing, parametrics, and the datasheet
   * URL, so this spends one request rather than three. The media endpoint is
   * consulted only when the product carries no datasheet URL of its own.
   */
  async lookup(mpn: string): Promise<PartLookup> {
    const details = await this.productDetails(mpn);
    const product = details.value.Product;
    const parametrics = parametricFacts(product);
    let datasheetUrl = datasheetUrlOf(product);
    datasheetUrl ??= datasheetUrlFromMedia((await this.media(mpn)).value);
    return {
      mpn: product.ManufacturerProductNumber,
      manufacturer: product.Manufacturer.Name,
      offers: toOffers(product, {
        fetchedAt: details.fetchedAt,
        cacheKey: details.cacheKey,
        currency: this.currency,
      }),
      datasheetUrl,
      facts: parametrics.facts,
      unmapped: parametrics.unmapped,
      failures: parametrics.failures,
      baseProductNumber: product.BaseProductNumber?.Name,
      cacheKey: details.cacheKey,
      fetchedAt: details.fetchedAt,
      product,
      hit: details.hit,
    };
  }

  private async run<T>(
    operation: OperationName,
    params: Record<string, unknown>,
    fetch: () => Promise<T>,
  ): Promise<DigiKeyResult<T>> {
    const tool = OPERATIONS[operation];
    const ledger = this.options.ledger;
    // The operation may spend quota; whether it did is reported in the output.
    const callId = ledger?.begin(tool, params, { spendsQuota: true });

    try {
      const cached = await this.options.cache.cached(
        {
          namespace: tool,
          params: {
            ...params,
            locale: this.options.locale,
            sandbox: this.options.sandbox === true,
            version: DIGIKEY_REQUEST_VERSION,
          },
        },
        async () => ({ value: await fetch() }),
        {
          codec: jsonCodec<T>(),
          ttlSeconds: this.options.ttlSeconds?.[operation] ?? DEFAULT_TTL_SECONDS[operation],
          ...(this.options.force === undefined ? {} : { force: this.options.force }),
          ...(this.options.cacheOnly === undefined ? {} : { cacheOnly: this.options.cacheOnly }),
        },
      );
      const result: DigiKeyResult<T> = {
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
