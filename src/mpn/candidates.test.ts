import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { KeywordSearchResponse } from '../adapters/digikey/schemas.js';
import { MouserSearchResponse } from '../adapters/mouser/schemas.js';
import { DigiKeyError } from '../adapters/digikey/errors.js';
import { MouserError } from '../adapters/mouser/errors.js';
import { CacheMissError } from '../cache/index.js';
import { gatherCandidates, type SearchResult } from './candidates.js';

const FIXTURES = path.resolve(import.meta.dirname, '..', '..', 'test', 'fixtures');

function load(distributor: string, name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, distributor, name), 'utf8'));
}

const digikeySearch = KeywordSearchResponse.parse(load('digikey', 'TPS54331.keyword.json'));
const mouserSearch = MouserSearchResponse.parse(load('mouser', 'TPS54331.keyword.json'));

function result<T>(value: T): SearchResult<T> {
  return {
    value,
    cacheKey: 'a'.repeat(64),
    fetchedAt: '2026-09-11T00:00:00.000Z',
    hit: true,
  };
}

const digikey = {
  currency: 'AUD' as const,
  searchKeyword: (): Promise<SearchResult<KeywordSearchResponse>> =>
    Promise.resolve(result(digikeySearch)),
};

const uncachedMouser = {
  currency: 'USD' as const,
  searchKeyword: (): Promise<SearchResult<MouserSearchResponse>> =>
    Promise.reject(new CacheMissError('CACHE_MISS', 'nothing stored')),
};

const mouser = {
  currency: 'USD' as const,
  searchKeyword: (): Promise<SearchResult<MouserSearchResponse>> =>
    Promise.resolve(result(mouserSearch)),
};

describe('gatherCandidates', () => {
  it('lets a cache-only miss out rather than recording it as a distributor failing', async () => {
    const uncached = {
      currency: 'AUD' as const,
      searchKeyword: (): Promise<SearchResult<KeywordSearchResponse>> =>
        Promise.reject(new CacheMissError('CACHE_MISS', 'nothing stored')),
    };

    // The caller asked for an answer only if it were free; that it is not is
    // the answer, and it is theirs to act on rather than a failure to record.
    await expect(
      gatherCandidates({ digikey: uncached, mouser }, 'TPS54331DR'),
    ).rejects.toMatchObject({ code: 'CACHE_MISS' });
    await expect(gatherCandidates({ mouser: uncachedMouser }, 'TPS54331DR')).rejects.toMatchObject({
      code: 'CACHE_MISS',
    });
  });

  it('collects every listing from both distributors', async () => {
    const gathering = await gatherCandidates({ digikey, mouser }, 'TPS54331DR');
    expect(gathering.query).toBe('TPS54331DR');
    expect(gathering.failures).toEqual([]);
    const digikeyMpns = gathering.candidates
      .filter((candidate) => candidate.distributor === 'digikey')
      .map((candidate) => candidate.mpn);
    expect(digikeyMpns).toContain('TPS54331DR');
    expect(digikeyMpns).toContain('TPS54331DDAR');
    expect(
      gathering.candidates.filter((candidate) => candidate.distributor === 'mouser'),
    ).not.toHaveLength(0);
  });

  it('decodes the listings whose manufacturer has a decoder', async () => {
    const { candidates } = await gatherCandidates({ digikey }, 'TPS54331DR');
    const exact = candidates.find((candidate) => candidate.mpn === 'TPS54331DR');
    expect(exact?.decoded?.basePart).toBe('TPS54331');
    expect(exact?.decoded?.package?.code).toBe('D');
    expect(exact?.manufacturer).toBe('Texas Instruments');

    // An evaluation module is a listing like any other, and stays undecoded.
    const evm = candidates.find((candidate) => candidate.mpn === 'TPS54331EVM-232');
    expect(evm?.decoded).toBeNull();
  });

  it('carries the offers, datasheet link and siblings each listing came with', async () => {
    const { candidates } = await gatherCandidates({ digikey, mouser }, 'TPS54331DR');
    const digikeyExact = candidates.find(
      (candidate) => candidate.distributor === 'digikey' && candidate.mpn === 'TPS54331DR',
    );
    expect(digikeyExact?.offers.length).toBeGreaterThan(0);
    expect(digikeyExact?.offers[0]?.currency).toBe('AUD');
    expect(digikeyExact?.datasheetUrl).toMatch(/^https?:/);
    expect(digikeyExact?.siblings).toEqual(['TPS54331']);

    const mouserExact = candidates.find(
      (candidate) => candidate.distributor === 'mouser' && candidate.mpn === 'TPS54331DR',
    );
    expect(mouserExact?.offers).toHaveLength(1);
    expect(mouserExact?.offers[0]?.distributor).toBe('mouser');
  });

  it('asks only the distributors it was given', async () => {
    const digikeyOnly = await gatherCandidates({ digikey }, 'TPS54331DR');
    expect(digikeyOnly.candidates.every((candidate) => candidate.distributor === 'digikey')).toBe(
      true,
    );
    const mouserOnly = await gatherCandidates({ mouser }, 'TPS54331DR');
    expect(mouserOnly.candidates.every((candidate) => candidate.distributor === 'mouser')).toBe(
      true,
    );
    const neither = await gatherCandidates({}, 'TPS54331DR');
    expect(neither).toEqual({
      query: 'TPS54331DR',
      candidates: [],
      skipped: [],
      failures: [],
    });
  });

  it('passes the limit through and defaults it', async () => {
    const asked: unknown[][] = [];
    const recording = {
      currency: 'AUD' as const,
      searchKeyword: (
        keywords: string,
        limit?: number,
      ): Promise<SearchResult<KeywordSearchResponse>> => {
        asked.push([keywords, limit]);
        return Promise.resolve(result(digikeySearch));
      },
    };
    await gatherCandidates({ digikey: recording }, 'TPS54331DR');
    await gatherCandidates({ digikey: recording }, 'TPS54331DR', { limit: 25 });
    expect(asked).toEqual([
      ['TPS54331DR', 10],
      ['TPS54331DR', 25],
    ]);
  });

  it('lists a product once even when it is both an exact match and a result', async () => {
    const duplicated = KeywordSearchResponse.parse({
      ...digikeySearch,
      ExactMatches: digikeySearch.Products.slice(0, 1),
    });
    const { candidates } = await gatherCandidates(
      {
        digikey: {
          currency: 'AUD',
          searchKeyword: () => Promise.resolve(result(duplicated)),
        },
      },
      'TPS54331DR',
    );
    expect(candidates.filter((candidate) => candidate.mpn === 'TPS54331DR')).toHaveLength(1);
    // The exact match is listed first, so the answer is at the top.
    expect(candidates[0]?.mpn).toBe('TPS54331DR');
  });

  it('skips a listing whose part number is not one, and says which', async () => {
    const odd = KeywordSearchResponse.parse({
      Products: [
        {
          ManufacturerProductNumber: 'EVB_RT8279GSP',
          Manufacturer: { Name: 'Richtek USA Inc.' },
          Parameters: [],
          ProductVariations: [],
        },
      ],
      ProductsCount: 1,
      ExactMatches: [],
    });
    const mouserOdd = MouserSearchResponse.parse({
      SearchResults: {
        NumberOfResult: 1,
        Parts: [
          {
            ManufacturerPartNumber: '(nothing)',
            Manufacturer: 'Richtek USA Inc.',
            MouserPartNumber: '000-1',
            PriceBreaks: [],
            ProductAttributes: [],
          },
        ],
      },
    });
    const gathering = await gatherCandidates(
      {
        digikey: { currency: 'AUD', searchKeyword: () => Promise.resolve(result(odd)) },
        mouser: { currency: 'USD', searchKeyword: () => Promise.resolve(result(mouserOdd)) },
      },
      'RT8279GSP',
    );
    expect(gathering.candidates).toEqual([]);
    expect(gathering.skipped).toEqual([
      { distributor: 'digikey', mpnAsListed: 'EVB_RT8279GSP', reason: 'MPN_INVALID' },
      { distributor: 'mouser', mpnAsListed: '(nothing)', reason: 'MPN_INVALID' },
    ]);
  });

  it('records a distributor that failed without losing what the other found', async () => {
    const broken = {
      currency: 'AUD' as const,
      searchKeyword: (): Promise<SearchResult<KeywordSearchResponse>> =>
        Promise.reject(new DigiKeyError('DIGIKEY_RATE_LIMITED', 'too many requests')),
    };
    const gathering = await gatherCandidates({ digikey: broken, mouser }, 'TPS54331DR');
    expect(gathering.failures).toEqual([
      { distributor: 'digikey', code: 'DIGIKEY_RATE_LIMITED', message: 'too many requests' },
    ]);
    expect(gathering.candidates.length).toBeGreaterThan(0);
  });

  it('records a Mouser failure the same way', async () => {
    const broken = {
      currency: 'USD' as const,
      searchKeyword: (): Promise<SearchResult<MouserSearchResponse>> =>
        Promise.reject(new MouserError('MOUSER_API_ERROR', 'invalid API key')),
    };
    const gathering = await gatherCandidates({ digikey, mouser: broken }, 'TPS54331DR');
    expect(gathering.failures).toEqual([
      { distributor: 'mouser', code: 'MOUSER_API_ERROR', message: 'invalid API key' },
    ]);
    expect(gathering.candidates.length).toBeGreaterThan(0);
  });

  it('raises when every distributor failed and nothing came back', async () => {
    const broken = {
      currency: 'AUD' as const,
      searchKeyword: (): Promise<SearchResult<KeywordSearchResponse>> =>
        Promise.reject(new Error('socket hang up')),
    };
    const raised = await gatherCandidates({ digikey: broken }, 'TPS54331DR').catch(
      (error: unknown) => error,
    );
    expect(raised).toMatchObject({
      code: 'MPN_LOOKUP_FAILED',
      details: {
        query: 'TPS54331DR',
        failures: [{ distributor: 'digikey', code: 'UNKNOWN', message: 'Error: socket hang up' }],
      },
    });
  });

  it('handles a search that matched nothing', async () => {
    const empty = MouserSearchResponse.parse({ SearchResults: { NumberOfResult: 0, Parts: [] } });
    const none = MouserSearchResponse.parse({});
    for (const value of [empty, none]) {
      const gathering = await gatherCandidates(
        { mouser: { currency: 'USD', searchKeyword: () => Promise.resolve(result(value)) } },
        'XL4015E1',
      );
      expect(gathering.candidates).toEqual([]);
      expect(gathering.failures).toEqual([]);
    }
  });
});
