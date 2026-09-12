import { z } from 'zod';

import { RUN_KINDS } from '../../core/run.js';
import { parseOrThrow } from '../../core/validation-error.js';
import { required } from '../../util/present.js';
import {
  SPEND_DIMENSIONS,
  cacheStats,
  errorStats,
  estimateSweep,
  gateStats,
  runTotals,
  spendBy,
  spendOverTime,
  toolStats,
  valueCost,
} from '../data/stats.js';
import type { RouteEntry } from '../server/app.js';
import type { Router } from '../server/router.js';
import { read, type ApiDeps } from './deps.js';
import { GranularityParam, IntParam, SourceParam, WindowShape, parseQuery } from './params.js';

/**
 * The statistics of the work itself: what it cost, how long it took, what
 * failed, and what a value is worth.
 *
 * Spend comes from the run rows the harness wrote; timing and failures from
 * the ledger. The two are kept apart on purpose — a run that never finished
 * has no cost but did make calls, and a view that merged them would hide it.
 */

const StatsQuery = z.strictObject({ source: SourceParam, ...WindowShape });

export function registerStats(router: Router<RouteEntry>, deps: ApiDeps): void {
  const ledgerFor = async (from?: string, to?: string) => {
    await deps.ledger.refresh();
    return deps.ledger.select({
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
    });
  };

  router.get(
    '/api/stats/overview',
    read(async (context) => {
      const query = parseQuery(StatsQuery, context.query);
      const opened = await deps.sources.open(query.source);
      const runs = opened.repositories.runs.list({ limit: 10_000 });
      const parts = opened.repositories.parts.findParts();
      const records = await ledgerFor(query.from, query.to);
      context.respond.json(context.response, context.facts, {
        source: opened.source.id,
        runs: runTotals(runs),
        value: valueCost(parts, runs),
        ledger: deps.ledger.totals(),
        cache: cacheStats(records),
        gate: gateStats(records),
        estimates: {
          extract: estimateSweep(runs, parts.length, 'extract'),
          verify: estimateSweep(runs, parts.length, 'verify'),
        },
      });
    }),
  );

  const SpendQuery = z.strictObject({ source: SourceParam, granularity: GranularityParam });

  router.get(
    '/api/stats/spend',
    read(async (context) => {
      const query = parseQuery(SpendQuery, context.query);
      const opened = await deps.sources.open(query.source);
      const runs = opened.repositories.runs.list({ limit: 10_000 });
      context.respond.json(context.response, context.facts, {
        granularity: query.granularity,
        points: spendOverTime(runs, query.granularity),
      });
    }),
  );

  router.get(
    '/api/stats/spend/:dimension',
    read(async (context) => {
      const query = parseQuery(z.strictObject({ source: SourceParam }), context.query);
      const dimension = parseOrThrow(
        z.enum(SPEND_DIMENSIONS),
        required(context.params.dimension, 'a dimension in the path'),
        'the spend dimension',
      );
      const opened = await deps.sources.open(query.source);
      context.respond.json(context.response, context.facts, {
        dimension,
        breakdown: spendBy(opened.repositories.runs.list({ limit: 10_000 }), dimension),
      });
    }),
  );

  router.get(
    '/api/stats/tools',
    read(async (context) => {
      const query = parseQuery(StatsQuery, context.query);
      const records = await ledgerFor(query.from, query.to);
      context.respond.json(context.response, context.facts, { tools: toolStats(records) });
    }),
  );

  router.get(
    '/api/stats/errors',
    read(async (context) => {
      const query = parseQuery(StatsQuery, context.query);
      const records = await ledgerFor(query.from, query.to);
      context.respond.json(context.response, context.facts, { errors: errorStats(records) });
    }),
  );

  router.get(
    '/api/stats/cache',
    read(async (context) => {
      const query = parseQuery(StatsQuery, context.query);
      const records = await ledgerFor(query.from, query.to);
      context.respond.json(context.response, context.facts, cacheStats(records));
    }),
  );

  router.get(
    '/api/stats/gate',
    read(async (context) => {
      const query = parseQuery(StatsQuery, context.query);
      const records = await ledgerFor(query.from, query.to);
      context.respond.json(context.response, context.facts, gateStats(records));
    }),
  );

  router.get(
    '/api/stats/value',
    read(async (context) => {
      const query = parseQuery(StatsQuery, context.query);
      const opened = await deps.sources.open(query.source);
      context.respond.json(
        context.response,
        context.facts,
        valueCost(
          opened.repositories.parts.findParts(),
          opened.repositories.runs.list({ limit: 10_000 }),
        ),
      );
    }),
  );

  const EstimateQuery = z.strictObject({
    source: SourceParam,
    kind: z.enum(RUN_KINDS).default('extract'),
    parts: IntParam.pipe(z.number().min(1).max(100_000)).optional(),
  });

  router.get(
    '/api/stats/estimate',
    read(async (context) => {
      const query = parseQuery(EstimateQuery, context.query);
      const opened = await deps.sources.open(query.source);
      const stored = opened.repositories.parts.findParts().length;
      context.respond.json(
        context.response,
        context.facts,
        estimateSweep(
          opened.repositories.runs.list({ limit: 10_000 }),
          query.parts ?? stored,
          query.kind,
        ),
      );
    }),
  );
}
