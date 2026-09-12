import { z } from 'zod';

import { RUN_KINDS } from '../../core/run.js';
import { required } from '../../util/present.js';
import { estimateSweep } from '../data/stats.js';
import { LaunchRequest } from '../runs/launcher.js';
import type { RouteEntry } from '../server/app.js';
import type { Router } from '../server/router.js';
import { openWritableSource, read, write, type ApiDeps } from './deps.js';
import { IntParam, SourceParam, parseQuery } from './params.js';

/**
 * Starting runs, watching them, and stopping them.
 *
 * Launching is a write: it changes the store and it spends money, so it needs
 * the token in a header and an origin this server serves (D67). Watching is a
 * read, and is an event stream because a run takes minutes.
 */

const EstimateQuery = z.strictObject({
  source: SourceParam,
  kind: z.enum(RUN_KINDS).default('extract'),
  parts: IntParam.pipe(z.number().min(1).max(1000)).default(1),
});

export function registerLaunches(router: Router<RouteEntry>, deps: ApiDeps): void {
  router.get(
    '/api/launches/estimate',
    read(async (context) => {
      const query = parseQuery(EstimateQuery, context.query);
      const opened = await deps.sources.open(query.source);
      const runs = opened.repositories.runs.list({ limit: 10_000 });
      const estimate = estimateSweep(runs, query.parts, query.kind);
      context.respond.json(context.response, context.facts, {
        ...estimate,
        // What a person needs in front of them before saying yes: the figure,
        // and how much history it rests on (D64).
        basisDescription:
          estimate.basis === 0
            ? 'nothing has been run yet, so this is a guess of zero rather than an estimate'
            : `from ${String(estimate.basis)} ${query.kind} run(s) already recorded`,
      });
    }),
  );

  router.get(
    '/api/launches',
    read((context) => {
      context.respond.json(context.response, context.facts, {
        launches: deps.launches.list().map((launch) => ({ ...launch, events: undefined })),
      });
    }),
  );

  router.post(
    '/api/launches',
    write(async (context) => {
      // A launch writes parts and runs into the store, so the same rule
      // applies as to any other write: not into an evaluation database.
      const opened = await openWritableSource(context, deps);
      const request = await context.json(LaunchRequest, 'a launch');
      const { event } = deps.auditor.around(
        opened,
        {
          actor: request.actor,
          action: 'run.launch',
          targetKind: 'part',
          targetId: request.mpns.join(','),
          reason: request.reason,
        },
        () => ({ after: { kind: request.kind, parts: request.mpns.length }, result: null }),
      );
      const { id } = deps.launcher.start(request);
      const launch = deps.launches.require(id);
      context.respond.json(
        context.response,
        context.facts,
        { event, launch: { ...launch, events: undefined } },
        { status: 202 },
      );
    }),
  );

  router.get(
    '/api/launches/:id',
    read((context) => {
      const id = required(context.params.id, 'a launch id in the path');
      context.respond.json(context.response, context.facts, deps.launches.require(id));
    }),
  );

  router.post(
    '/api/launches/:id/cancel',
    write((context) => {
      const id = required(context.params.id, 'a launch id in the path');
      const launch = deps.launches.cancel(id);
      deps.launches.emit(id, 'progress', { cancelling: true });
      context.respond.json(context.response, context.facts, {
        launch: { ...launch, events: undefined },
      });
    }),
  );

  router.get(
    '/api/launches/:id/events',
    read((context) => {
      const id = required(context.params.id, 'a launch id in the path');
      const launch = deps.launches.require(id);
      const lastSeen = Number(context.headers['last-event-id'] ?? '0');
      const stream = context.stream();

      // Everything missed first, so a page that reloads mid-run catches up
      // rather than starting from whatever happens next.
      for (const event of deps.launches.since(id, Number.isFinite(lastSeen) ? lastSeen : 0)) {
        stream.send(event.kind, event, String(event.sequence));
      }
      if (launch.state !== 'running') {
        stream.send('closed', { state: launch.state });
        stream.close();
        return;
      }
      const unsubscribe = deps.launches.subscribe(id, (event) => {
        stream.send(event.kind, event, String(event.sequence));
        if (event.kind === 'finished' || event.kind === 'failed' || event.kind === 'cancelled') {
          stream.send('closed', { state: event.kind });
          stream.close();
          unsubscribe();
        }
      });
    }),
  );
}
