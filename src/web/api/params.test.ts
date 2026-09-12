import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  BoolParam,
  DirectionParam,
  GranularityParam,
  IntParam,
  ListParam,
  NumberParam,
  PaginationShape,
  PricingShape,
  SourceParam,
  paginate,
  parseQuery,
  queryObject,
  sortBy,
} from './params.js';

describe('queryObject', () => {
  it('keeps a single value single and a repeated one as a list', () => {
    expect(queryObject(new URLSearchParams('a=1&b=2&b=3'))).toStrictEqual({
      a: '1',
      b: ['2', '3'],
    });
  });

  it('keeps an empty value rather than dropping the key', () => {
    expect(queryObject(new URLSearchParams('a='))).toStrictEqual({ a: '' });
  });
});

describe('decoders', () => {
  it('reads numbers and refuses what is not one', () => {
    expect(NumberParam.parse('3.5')).toBe(3.5);
    expect(NumberParam.safeParse('abc').success).toBe(false);
    expect(NumberParam.safeParse('   ').success).toBe(false);
    expect(IntParam.parse('7')).toBe(7);
    expect(IntParam.safeParse('7.5').success).toBe(false);
  });

  it('reads booleans strictly', () => {
    expect(BoolParam.parse('true')).toBe(true);
    expect(BoolParam.parse('false')).toBe(false);
    expect(BoolParam.safeParse('yes').success).toBe(false);
  });

  it('reads a comma-separated list', () => {
    expect(ListParam.parse('TPS54331DR, LM5164DDAR')).toStrictEqual(['TPS54331DR', 'LM5164DDAR']);
    expect(ListParam.safeParse('').success).toBe(false);
  });

  it('defaults the source, the page and the pricing', () => {
    expect(SourceParam.parse(undefined)).toBe('live');
    const Query = z.object({ ...PaginationShape, ...PricingShape });
    expect(Query.parse({})).toStrictEqual({
      limit: 100,
      offset: 0,
      quantity: 1,
      currency: 'AUD',
    });
    expect(Query.parse({ limit: '5', quantity: '100', currency: 'USD' })).toMatchObject({
      limit: 5,
      quantity: 100,
      currency: 'USD',
    });
  });

  it('refuses a page size beyond the limit and a currency it does not hold', () => {
    const Query = z.object({ ...PaginationShape, ...PricingShape });
    expect(Query.safeParse({ limit: '5000' }).success).toBe(false);
    expect(Query.safeParse({ currency: 'XYZ' }).success).toBe(false);
  });

  it('defaults granularity and direction', () => {
    expect(GranularityParam.parse(undefined)).toBe('day');
    expect(DirectionParam.parse(undefined)).toBe('asc');
  });
});

describe('parseQuery', () => {
  const Query = z.strictObject({ mpn: z.string(), ...PaginationShape });

  it('decodes a whole query string', () => {
    expect(parseQuery(Query, new URLSearchParams('mpn=TPS54331DR&limit=20'))).toStrictEqual({
      mpn: 'TPS54331DR',
      limit: 20,
      offset: 0,
    });
  });

  it('reports what was wrong with it', () => {
    expect(() => parseQuery(Query, new URLSearchParams('mpn=x&limit=abc'))).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
  });
});

describe('paginate', () => {
  it('returns a window and the total behind it', () => {
    expect(paginate([1, 2, 3, 4, 5], 1, 2)).toStrictEqual({
      total: 5,
      offset: 1,
      limit: 2,
      items: [2, 3],
    });
  });

  it('returns nothing past the end without complaining', () => {
    expect(paginate([1, 2], 10, 5).items).toStrictEqual([]);
  });
});

describe('sortBy', () => {
  const rows = [
    { mpn: 'B', price: 2 },
    { mpn: 'A', price: undefined },
    { mpn: 'C', price: 1 },
  ];

  it('sorts numbers both ways, leaving the input alone', () => {
    expect(sortBy(rows, (row) => row.price, 'asc').map((row) => row.mpn)).toStrictEqual([
      'C',
      'B',
      'A',
    ]);
    expect(sortBy(rows, (row) => row.price, 'desc').map((row) => row.mpn)).toStrictEqual([
      'B',
      'C',
      'A',
    ]);
    expect(rows[0]?.mpn).toBe('B');
  });

  it('puts what it does not know last whichever way it sorts', () => {
    expect(sortBy(rows, (row) => row.price, 'desc').at(-1)?.mpn).toBe('A');
    expect(sortBy([{ a: undefined }, { a: undefined }], (row) => row.a, 'asc')).toHaveLength(2);
  });

  it('sorts strings by locale', () => {
    expect(sortBy(rows, (row) => row.mpn, 'asc').map((row) => row.mpn)).toStrictEqual([
      'A',
      'B',
      'C',
    ]);
  });

  it('compares a mixed column as text rather than pretending', () => {
    const mixed = [{ v: 2 }, { v: 'ten' }, { v: 1 }];
    expect(sortBy(mixed, (row) => row.v, 'asc').map((row) => row.v)).toStrictEqual([1, 2, 'ten']);
  });
});
