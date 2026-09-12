import { z } from 'zod';

import { CURRENCIES } from '../../core/primitives.js';
import { parseOrThrow } from '../../core/validation-error.js';
import { GRANULARITIES } from '../data/aggregate.js';
import { LIVE_SOURCE } from '../data/sources.js';

/**
 * Query-string decoding.
 *
 * Everything in a URL is a string, so these schemas decode rather than
 * coerce: `limit=abc` is rejected by name, never quietly turned into a
 * default. That is the same rule the store follows — validate and reject —
 * applied where the strings come in.
 */

export function queryObject(params: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    const single = values[0];
    out[key] = values.length > 1 || single === undefined ? values : single;
  }
  return out;
}

export function parseQuery<T extends z.ZodType>(
  schema: T,
  params: URLSearchParams,
  subject = 'the query string',
): z.output<T> {
  return parseOrThrow(schema, queryObject(params), subject);
}

export const NumberParam = z
  .string()
  .refine((text) => text.trim() !== '' && Number.isFinite(Number(text)), {
    error: 'expected a number',
  })
  .transform((text) => Number(text));

export const IntParam = NumberParam.refine(Number.isInteger, { error: 'expected a whole number' });

export const BoolParam = z.enum(['true', 'false']).transform((text) => text === 'true');

/** A comma-separated list, with blanks dropped. */
export const ListParam = z
  .string()
  .transform((text) => text.split(',').map((part) => part.trim()))
  .pipe(z.array(z.string().min(1)).min(1));

export const SourceParam = z.string().min(1).max(128).default(LIVE_SOURCE);

export const PaginationShape = {
  limit: IntParam.pipe(z.number().min(1).max(1000)).default(100),
  offset: IntParam.pipe(z.number().min(0)).default(0),
} as const;

export const PricingShape = {
  quantity: IntParam.pipe(z.number().min(1).max(1_000_000)).default(1),
  currency: z.enum(CURRENCIES).default('AUD'),
} as const;

export const WindowShape = {
  from: z.string().min(4).max(40).optional(),
  to: z.string().min(4).max(40).optional(),
} as const;

export const GranularityParam = z.enum(GRANULARITIES).default('day');

export const SourceQuery = z.looseObject({ source: SourceParam });

export interface Page<T> {
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly items: readonly T[];
}

/** One page of a list, with the total so the client can say "of 2,505". */
export function paginate<T>(items: readonly T[], offset: number, limit: number): Page<T> {
  return { total: items.length, offset, limit, items: items.slice(offset, offset + limit) };
}

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export const DirectionParam = z.enum(SORT_DIRECTIONS).default('asc');

/**
 * Sorts by a named field, missing values last whichever way the sort runs.
 *
 * A part with no price is not cheaper than every other part, and a table that
 * says so is worse than one that admits it does not know.
 */
export function sortBy<T>(
  items: readonly T[],
  value: (item: T) => string | number | undefined,
  direction: 'asc' | 'desc',
): T[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left === undefined && right === undefined) {
      return 0;
    }
    if (left === undefined) {
      return 1;
    }
    if (right === undefined) {
      return -1;
    }
    if (typeof left === 'string' || typeof right === 'string') {
      return sign * String(left).localeCompare(String(right));
    }
    return sign * (left - right);
  });
}
