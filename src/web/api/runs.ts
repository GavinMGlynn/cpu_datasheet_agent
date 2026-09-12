import { z } from 'zod';

import { RUN_KINDS, RUN_RESULTS } from '../../core/run.js';
import { isBlobRef, readBlob } from '../../log/ledger-reader.js';
import { required } from '../../util/present.js';
import { sessionTree } from '../data/stats.js';
import type { RouteEntry } from '../server/app.js';
import { WebError } from '../server/errors.js';
import type { Router } from '../server/router.js';
import { openSource, read, type ApiDeps } from './deps.js';
import {
  BoolParam,
  PaginationShape,
  SourceParam,
  WindowShape,
  paginate,
  parseQuery,
} from './params.js';

/**
 * Runs and the ledger.
 *
 * A run row says what a run cost and how it ended; the ledger says what it
 * did. They are joined by session, and every run view offers the call tree
 * underneath it, because "this run cost $4.27" is not a finding until you can
 * see the nineteen calls it made.
 */

const RunQuery = z.strictObject({
  source: SourceParam,
  mpn: z.string().min(1).max(64).optional(),
  kind: z.enum(RUN_KINDS).optional(),
  result: z.enum(RUN_RESULTS).optional(),
  promptVersion: z.string().min(1).max(64).optional(),
  model: z.string().min(1).max(64).optional(),
  finished: BoolParam.optional(),
  ...PaginationShape,
});

const LedgerQuery = z.strictObject({
  sessionId: z.string().min(1).max(128).optional(),
  tool: z.string().min(1).max(64).optional(),
  parentId: z.string().min(1).max(64).optional(),
  failed: BoolParam.optional(),
  spendsQuota: BoolParam.optional(),
  text: z.string().min(1).max(200).optional(),
  ...WindowShape,
  ...PaginationShape,
});

export function registerRuns(router: Router<RouteEntry>, deps: ApiDeps): void {
  router.get(
    '/api/runs',
    read(async (context) => {
      const query = parseQuery(RunQuery, context.query);
      const opened = await deps.sources.open(query.source);
      const runs = opened.repositories.runs
        .list({
          ...(query.mpn === undefined ? {} : { mpn: query.mpn }),
          ...(query.kind === undefined ? {} : { kind: query.kind }),
          ...(query.result === undefined ? {} : { result: query.result }),
          ...(query.promptVersion === undefined ? {} : { promptVersion: query.promptVersion }),
          ...(query.finished === undefined ? {} : { finished: query.finished }),
          limit: 10_000,
        })
        .filter((run) => query.model === undefined || run.model === query.model);
      context.respond.json(context.response, context.facts, {
        source: opened.source.id,
        ...paginate(runs, query.offset, query.limit),
      });
    }),
  );

  router.get(
    '/api/runs/:id',
    read(async (context) => {
      const opened = await openSource(context, deps);
      const id = required(context.params.id, 'a run id in the path');
      const run = opened.repositories.runs.get(id);
      if (run === undefined) {
        throw new WebError(404, 'WEB_RUN_NOT_FOUND', `no run ${id} in ${opened.source.id}`, {
          details: { id, source: opened.source.id },
        });
      }
      await deps.ledger.refresh();
      const calls = run.sessionId === undefined ? [] : deps.ledger.bySession(run.sessionId);
      context.respond.json(context.response, context.facts, {
        source: opened.source.id,
        run,
        calls,
        tree: sessionTree(calls),
      });
    }),
  );

  router.get(
    '/api/ledger',
    read(async (context) => {
      const query = parseQuery(LedgerQuery, context.query);
      await deps.ledger.refresh();
      const records = deps.ledger.select({
        ...(query.sessionId === undefined ? {} : { sessionId: query.sessionId }),
        ...(query.tool === undefined ? {} : { tool: query.tool }),
        ...(query.parentId === undefined ? {} : { parentId: query.parentId }),
        ...(query.failed === undefined ? {} : { failed: query.failed }),
        ...(query.spendsQuota === undefined ? {} : { spendsQuota: query.spendsQuota }),
        ...(query.text === undefined ? {} : { text: query.text }),
        ...(query.from === undefined ? {} : { from: query.from }),
        ...(query.to === undefined ? {} : { to: query.to }),
      });
      context.respond.json(
        context.response,
        context.facts,
        paginate(records, query.offset, query.limit),
      );
    }),
  );

  router.get(
    '/api/ledger/tools',
    read(async (context) => {
      await deps.ledger.refresh();
      context.respond.json(context.response, context.facts, {
        tools: deps.ledger.tools(),
        sessions: deps.ledger.sessions(),
        totals: deps.ledger.totals(),
        malformed: deps.ledger.malformed(),
      });
    }),
  );

  router.get(
    '/api/ledger/sessions/:id',
    read(async (context) => {
      await deps.ledger.refresh();
      const id = required(context.params.id, 'a session id in the path');
      const calls = deps.ledger.bySession(id);
      if (calls.length === 0) {
        throw new WebError(404, 'WEB_SESSION_NOT_FOUND', `the ledger holds no session ${id}`, {
          details: { sessionId: id },
        });
      }
      context.respond.json(context.response, context.facts, {
        sessionId: id,
        calls,
        tree: sessionTree(calls),
      });
    }),
  );

  router.get(
    '/api/ledger/:id',
    read(async (context) => {
      await deps.ledger.refresh();
      const id = required(context.params.id, 'a call id in the path');
      const record = deps.ledger.find(id);
      if (record === undefined) {
        throw new WebError(404, 'WEB_CALL_NOT_FOUND', `the ledger holds no call ${id}`, {
          details: { id },
        });
      }
      // A large output was written to a blob file rather than inline. The
      // record is useless without it, so it is read back here rather than
      // showing the reader a pointer.
      const output = isBlobRef(record.output)
        ? await readBlob(deps.ledgerDir, record.output)
        : record.output;
      context.respond.json(context.response, context.facts, {
        record: { ...record, output },
        children: deps.ledger.children(id),
        blob: isBlobRef(record.output),
      });
    }),
  );
}
