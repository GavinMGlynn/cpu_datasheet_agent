import { z } from 'zod';

import { parseOrThrow } from '../../core/validation-error.js';
import { findAlternates } from '../../query/alternates.js';
import { AlternateQuery } from '../../query/types.js';
import type { RouteEntry } from '../server/app.js';
import type { Router } from '../server/router.js';
import { openSource, read, type ApiDeps } from './deps.js';
import { SourceQuery, parseQuery } from './params.js';

/**
 * The alternates endpoint: the question the project was built to answer.
 *
 * The whole query surface is exposed, not a convenient subset — every
 * constraint is a requirement, and a form that silently dropped one would
 * recommend a part that does not meet it. The answer carries the
 * pin-compatibility disclaimer the engine attaches, unedited.
 */
export function registerAlternates(router: Router<RouteEntry>, deps: ApiDeps): void {
  router.post(
    '/api/alternates',
    read(async (context) => {
      const { source } = parseQuery(SourceQuery, context.query);
      const opened = await deps.sources.open(source);
      const query = await context.json(AlternateQuery, 'AlternateQuery');
      context.respond.json(context.response, context.facts, {
        source: opened.source.id,
        result: findAlternates(opened.repositories, query),
      });
    }),
  );

  // The same query as a GET, so a result can be linked to and reloaded. The
  // ranges are written the way the command line takes them — `8-28` — because
  // a URL a person types should read like one.
  const GetQuery = z.strictObject({
    source: z.string().min(1).max(128).default('live'),
    mpn: z.string().min(1).max(64),
    vin: z
      .string()
      .regex(/^\d+(\.\d+)?-\d+(\.\d+)?$/u, { error: 'expected a range such as 8-28' })
      .optional(),
    iout: z.string().optional(),
    topology: z.string().optional(),
    outputType: z.string().optional(),
    integration: z.string().optional(),
    packageFamily: z.string().optional(),
    temperatureGrade: z.string().optional(),
    features: z.string().optional(),
    quantity: z.string().default('1'),
    currency: z.string().default('AUD'),
    includeUnverified: z.enum(['true', 'false']).default('false'),
    limit: z.string().default('5'),
  });

  router.get(
    '/api/alternates',
    read(async (context) => {
      const raw = parseQuery(GetQuery, context.query);
      const opened = await deps.sources.open(raw.source);
      const [min, max] = (raw.vin ?? '').split('-');
      const query = parseOrThrow(
        AlternateQuery,
        {
          mpn: raw.mpn,
          ...(raw.vin === undefined
            ? {}
            : { vinRange: { unit: 'V', min: Number(min), max: Number(max) } }),
          ...(raw.iout === undefined ? {} : { ioutMin: { unit: 'A', value: Number(raw.iout) } }),
          ...(raw.topology === undefined ? {} : { topology: raw.topology }),
          ...(raw.outputType === undefined ? {} : { outputType: raw.outputType }),
          ...(raw.integration === undefined ? {} : { integration: raw.integration }),
          ...(raw.packageFamily === undefined ? {} : { packageFamily: raw.packageFamily }),
          ...(raw.temperatureGrade === undefined ? {} : { temperatureGrade: raw.temperatureGrade }),
          ...(raw.features === undefined ? {} : { features: raw.features.split(',') }),
          quantity: Number(raw.quantity),
          currency: raw.currency,
          includeUnverified: raw.includeUnverified === 'true',
          limit: Number(raw.limit),
        },
        'AlternateQuery',
      );
      context.respond.json(context.response, context.facts, {
        source: opened.source.id,
        result: findAlternates(opened.repositories, query),
      });
    }),
  );

  router.get(
    '/api/alternates/constraints',
    read(async (context) => {
      // What a form can offer, taken from the schema rather than restated.
      const opened = await openSource(context, deps);
      context.respond.json(context.response, context.facts, {
        source: opened.source.id,
        manufacturers: [
          ...new Set(opened.repositories.parts.findParts().map((part) => part.manufacturer)),
        ].sort(),
        shape: Object.keys(AlternateQuery.shape),
      });
    }),
  );
}
