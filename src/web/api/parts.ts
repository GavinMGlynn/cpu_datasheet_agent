import { z } from 'zod';

import { CLASSIFICATION_AXES, type ClassificationAxis } from '../../core/classification.js';
import { PARAMETER_KEYS, ParameterKey } from '../../core/parameter-keys.js';
import { CATEGORIES, PART_STATUSES, type Part } from '../../core/part.js';
import type { Verification } from '../../core/verification.js';
import { unitPriceAt } from '../../query/pricing.js';
import type { RequestContext, RouteEntry } from '../server/app.js';
import type { Router } from '../server/router.js';
import {
  catalogTotals,
  parameterCoverage,
  parameterDistribution,
  summarisePart,
  summariseParts,
  verdictCounts,
  type PartSummary,
} from '../data/catalog.js';
import { openSource, read, requirePart, type ApiDeps } from './deps.js';
import {
  DirectionParam,
  IntParam,
  ListParam,
  PaginationShape,
  PricingShape,
  SourceParam,
  paginate,
  parseQuery,
  sortBy,
} from './params.js';

/**
 * The part endpoints.
 *
 * Everything here is a projection of the stored aggregate: the site never
 * recomputes a parameter, it shows the one that was stored and the provenance
 * that came with it.
 */

const SORT_FIELDS = [
  'mpn',
  'manufacturer',
  'status',
  'updatedAt',
  'price',
  'stock',
  'stated',
  'verified',
] as const;
type SortField = (typeof SORT_FIELDS)[number];

const ListQuery = z.strictObject({
  source: SourceParam,
  status: z.enum(PART_STATUSES).optional(),
  manufacturer: z.string().min(1).max(120).optional(),
  category: z.enum(CATEGORIES).optional(),
  /** Case-insensitive match on the part number and the manufacturer. */
  text: z.string().min(1).max(120).optional(),
  sort: z.enum(SORT_FIELDS).default('mpn'),
  direction: DirectionParam,
  ...PaginationShape,
  ...PricingShape,
});

function sortValue(summary: PartSummary, field: SortField): string | number | undefined {
  switch (field) {
    case 'mpn':
      return summary.mpn;
    case 'manufacturer':
      return summary.manufacturer;
    case 'status':
      return summary.status;
    case 'updatedAt':
      return summary.updatedAt;
    case 'price':
      return summary.bestPrice?.amount;
    case 'stock':
      return summary.stock;
    case 'stated':
      return summary.parameters.stated;
    case 'verified':
      return summary.parameters.verified;
  }
}

function matchesText(part: Part, text: string): boolean {
  const needle = text.toLowerCase();
  return (
    part.mpn.toLowerCase().includes(needle) || part.manufacturer.toLowerCase().includes(needle)
  );
}

export interface ParameterRow {
  readonly key: string;
  readonly value: unknown;
  readonly confidence: string;
  readonly provenance: unknown;
  readonly conflicts: unknown;
  /** The most recent verdict on this parameter, when one has been reached. */
  readonly verdict: Verification | undefined;
}

/** One row per schema key, whether or not the part states a value for it. */
export function parameterRows(part: Part): ParameterRow[] {
  const latest = new Map<string, Verification>();
  for (const verification of part.verifications) {
    const held = latest.get(verification.parameterKey);
    if (held === undefined || held.checkedAt <= verification.checkedAt) {
      latest.set(verification.parameterKey, verification);
    }
  }
  return PARAMETER_KEYS.map((key) => {
    const parameter = part.parameters[key];
    return {
      key,
      value: parameter.value,
      confidence: parameter.confidence,
      provenance: parameter.provenance,
      conflicts: parameter.conflicts,
      verdict: latest.get(key),
    };
  });
}

export function registerParts(router: Router<RouteEntry>, deps: ApiDeps): void {
  router.get(
    '/api/parts',
    read(async (context: RequestContext) => {
      const query = parseQuery(ListQuery, context.query);
      const opened = await deps.sources.open(query.source);
      const parts = opened.repositories.parts
        .findParts({
          ...(query.category === undefined ? {} : { category: query.category }),
          ...(query.status === undefined ? {} : { status: query.status }),
        })
        .filter(
          (part) => query.manufacturer === undefined || part.manufacturer === query.manufacturer,
        )
        .filter((part) => query.text === undefined || matchesText(part, query.text));
      const summaries = summariseParts(parts, {
        quantity: query.quantity,
        currency: query.currency,
      });
      const sorted = sortBy(
        summaries,
        (summary) => sortValue(summary, query.sort),
        query.direction,
      );
      context.respond.json(context.response, context.facts, {
        source: opened.source.id,
        ...paginate(sorted, query.offset, query.limit),
      });
    }),
  );

  router.get(
    '/api/parts/:mpn',
    read(async (context) => {
      const opened = await openSource(context, deps);
      const { quantity, currency } = parseQuery(z.looseObject(PricingShape), context.query);
      const mpn = context.params.mpn ?? '';
      const part = requirePart(opened, mpn);
      context.respond.json(context.response, context.facts, {
        source: opened.source.id,
        part,
        summary: summarisePart(part, { quantity, currency }),
        parameters: parameterRows(part),
        verdicts: verdictCounts(part),
        runs: opened.repositories.runs.list({ mpn }),
        escalations: opened.repositories.escalations.list({ mpn }),
        datasheetMpns:
          part.datasheet === undefined
            ? []
            : opened.repositories.datasheets.mpnsCoveredBy(part.datasheet.sha256),
      });
    }),
  );

  router.get(
    '/api/parts/:mpn/parameters',
    read(async (context) => {
      const opened = await openSource(context, deps);
      const part = requirePart(opened, context.params.mpn ?? '');
      context.respond.json(context.response, context.facts, { parameters: parameterRows(part) });
    }),
  );

  router.get(
    '/api/parts/:mpn/offers',
    read(async (context) => {
      const opened = await openSource(context, deps);
      const { quantity } = parseQuery(z.looseObject(PricingShape), context.query);
      const part = requirePart(opened, context.params.mpn ?? '');
      context.respond.json(context.response, context.facts, {
        offers: part.offers.map((offer) => ({
          ...offer,
          unitPrice: unitPriceAt(offer, quantity),
        })),
      });
    }),
  );

  router.get(
    '/api/parts/:mpn/runs',
    read(async (context) => {
      const opened = await openSource(context, deps);
      const mpn = context.params.mpn ?? '';
      requirePart(opened, mpn);
      context.respond.json(context.response, context.facts, {
        runs: opened.repositories.runs.list({ mpn }),
      });
    }),
  );

  router.get(
    '/api/parts/:mpn/verifications',
    read(async (context) => {
      const opened = await openSource(context, deps);
      const mpn = context.params.mpn ?? '';
      const part = requirePart(opened, mpn);
      context.respond.json(context.response, context.facts, {
        counts: verdictCounts(part),
        verifications: opened.repositories.verifications.list(mpn),
      });
    }),
  );

  router.get(
    '/api/catalog/totals',
    read(async (context) => {
      const opened = await openSource(context, deps);
      context.respond.json(context.response, context.facts, {
        source: opened.source.id,
        totals: catalogTotals(opened.repositories.parts.findParts()),
      });
    }),
  );

  router.get(
    '/api/catalog/coverage',
    read(async (context) => {
      const opened = await openSource(context, deps);
      context.respond.json(context.response, context.facts, {
        coverage: parameterCoverage(opened.repositories.parts.findParts()),
      });
    }),
  );

  const DistributionQuery = z.strictObject({
    source: SourceParam,
    buckets: IntParam.pipe(z.number().min(1).max(100)).default(10),
  });

  router.get(
    '/api/catalog/distribution/:key',
    read(async (context) => {
      const query = parseQuery(DistributionQuery, context.query);
      const key = ParameterKey.parse(context.params.key);
      const opened = await deps.sources.open(query.source);
      context.respond.json(
        context.response,
        context.facts,
        parameterDistribution(opened.repositories.parts.findParts(), key, query.buckets),
      );
    }),
  );

  const CompareQuery = z.strictObject({
    source: SourceParam,
    mpns: ListParam,
    ...PricingShape,
  });

  router.get(
    '/api/catalog/compare',
    read(async (context) => {
      const query = parseQuery(CompareQuery, context.query);
      const opened = await deps.sources.open(query.source);
      const parts = query.mpns.map((mpn) => requirePart(opened, mpn));
      const axes: ClassificationAxis[] = [...CLASSIFICATION_AXES];
      context.respond.json(context.response, context.facts, {
        parts: parts.map((part) => ({
          summary: summarisePart(part, { quantity: query.quantity, currency: query.currency }),
          parameters: parameterRows(part),
        })),
        keys: PARAMETER_KEYS,
        axes,
      });
    }),
  );
}
