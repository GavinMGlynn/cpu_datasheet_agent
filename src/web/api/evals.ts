import { z } from 'zod';

import { required } from '../../util/present.js';
import { failures, parameterScores } from '../data/evals.js';
import type { RouteEntry } from '../server/app.js';
import { WebError } from '../server/errors.js';
import type { Router } from '../server/router.js';
import { read, type ApiDeps } from './deps.js';
import { parseQuery } from './params.js';

/**
 * The evaluation endpoints.
 *
 * A result directory is the record of one prompt against the golden set, and
 * these read them as they are on disk. The site never re-scores: a number
 * shown here is the number that was published, and a comparison is between
 * two runs that each happened.
 */

const CompareQuery = z.strictObject({
  from: z.string().min(1).max(200),
  to: z.string().min(1).max(200),
});

export function registerEvals(router: Router<RouteEntry>, deps: ApiDeps): void {
  router.get(
    '/api/evals',
    read(async (context) => {
      context.respond.json(context.response, context.facts, { results: await deps.evals.list() });
    }),
  );

  // Registered before `/api/evals/:id`, which would otherwise claim it: the
  // router resolves in registration order.
  router.get(
    '/api/evals/compare',
    read(async (context) => {
      const query = parseQuery(CompareQuery, context.query);
      context.respond.json(context.response, context.facts, {
        comparison: await deps.evals.compare(query.from, query.to),
      });
    }),
  );

  router.get(
    '/api/evals/:id',
    read(async (context) => {
      const id = required(context.params.id, 'a result id in the path');
      const report = await deps.evals.report(id);
      context.respond.json(context.response, context.facts, { id, report });
    }),
  );

  router.get(
    '/api/evals/:id/summary',
    read(async (context) => {
      const id = required(context.params.id, 'a result id in the path');
      const summary = await deps.evals.summary(id);
      context.respond.text(
        context.response,
        context.facts,
        summary,
        'text/markdown; charset=utf-8',
      );
    }),
  );

  router.get(
    '/api/evals/:id/parameters',
    read(async (context) => {
      const id = required(context.params.id, 'a result id in the path');
      const report = await deps.evals.report(id);
      context.respond.json(context.response, context.facts, {
        id,
        parameters: parameterScores(report),
      });
    }),
  );

  router.get(
    '/api/evals/:id/failures',
    read(async (context) => {
      const id = required(context.params.id, 'a result id in the path');
      const report = await deps.evals.report(id);
      context.respond.json(context.response, context.facts, { id, failures: failures(report) });
    }),
  );

  router.get(
    '/api/golden',
    read((context) => {
      context.respond.json(context.response, context.facts, {
        parts: deps.evals.golden().map((entry) => ({
          file: entry.file,
          mpn: entry.part.mpn,
          manufacturer: entry.part.manufacturer,
          reason: entry.part.reason,
          readBy: entry.part.readBy,
          readAt: entry.part.readAt,
          pageCount: entry.part.datasheet.pageCount,
        })),
      });
    }),
  );

  router.get(
    '/api/golden/health',
    read((context) => {
      context.respond.json(context.response, context.facts, deps.evals.goldenHealth());
    }),
  );

  router.get(
    '/api/golden/:mpn',
    read((context) => {
      const mpn = required(context.params.mpn, 'a part number in the path');
      const found = deps.evals.golden().find((entry) => entry.part.mpn === mpn);
      if (found === undefined) {
        throw new WebError(404, 'WEB_GOLDEN_NOT_FOUND', `${mpn} is not in the golden set`, {
          details: { mpn },
        });
      }
      context.respond.json(context.response, context.facts, { file: found.file, part: found.part });
    }),
  );
}
