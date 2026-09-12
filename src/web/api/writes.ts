import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { AUDIT_TARGETS } from '../../core/audit.js';
import { ParameterKey } from '../../core/parameter-keys.js';
import { PART_STATUSES, type Part } from '../../core/part.js';
import { parseOrThrow } from '../../core/validation-error.js';
import { GoldenPart } from '../../eval/golden.js';
import { required } from '../../util/present.js';
import type { OpenSource } from '../data/sources.js';
import type { RouteEntry } from '../server/app.js';
import { WebError } from '../server/errors.js';
import type { Router } from '../server/router.js';
import { openWritableSource, read, requirePart, write, type ApiDeps } from './deps.js';
import { PaginationShape, paginate, parseQuery } from './params.js';

/**
 * Everything the browser can change.
 *
 * Three rules hold across all of it. The reason is mandatory and is stored,
 * not logged. The previous value is kept in the audit row, so a correction
 * never erases what the model said. And only the live store can be written:
 * an evaluation database is the evidence behind a published number (D69).
 */

/** Fields every write carries. */
const Attribution = {
  actor: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(3).max(2000),
} as const;

const CorrectionBody = z.strictObject({
  ...Attribution,
  /** The corrected value, in the shape the schema expects for this parameter. */
  value: z.json(),
  /** What the person read, and where. Stored as the value's provenance. */
  note: z.string().trim().min(3).max(1000),
});

const StatusBody = z.strictObject({ ...Attribution, status: z.enum(PART_STATUSES) });

const ResolveBody = z.strictObject({ ...Attribution, answer: z.string().trim().min(1).max(2000) });

const GoldenBody = z.strictObject({ ...Attribution, part: z.json() });

const PurgeBody = z.strictObject({
  ...Attribution,
  namespace: z.string().trim().min(1).max(64),
  hash: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{64}$/u, { error: 'expected a sha-256 digest' }),
});

const AuditQuery = z.strictObject({
  source: z.string().min(1).max(128).default('live'),
  targetKind: z.enum(AUDIT_TARGETS).optional(),
  targetId: z.string().min(1).max(200).optional(),
  action: z.string().min(1).max(64).optional(),
  actor: z.string().min(1).max(120).optional(),
  ...PaginationShape,
});

const EscalationQuery = z.strictObject({
  source: z.string().min(1).max(128).default('live'),
  mpn: z.string().min(1).max(64).optional(),
  resolved: z.enum(['true', 'false']).optional(),
});

/** Replaces one parameter, keeping every other field of the aggregate. */
function withParameter(part: Part, key: string, parameter: unknown): unknown {
  return {
    ...part,
    parameters: { ...part.parameters, [key]: parameter },
  };
}

function goldenFile(dir: string, mpn: string): string {
  // The golden files are named for the part, and the part number is checked
  // against the schema first, so this cannot escape the directory.
  return path.join(dir, `${mpn}.json`);
}

export function registerWrites(router: Router<RouteEntry>, deps: ApiDeps): void {
  const auditor = deps.auditor;
  const writable = (context: Parameters<RouteEntry['handler']>[0]): Promise<OpenSource> =>
    openWritableSource(context, deps);

  router.post(
    '/api/parts/:mpn/parameters/:key',
    write(async (context) => {
      const opened = await writable(context);
      const mpn = required(context.params.mpn, 'a part number in the path');
      const key = parseOrThrow(
        ParameterKey,
        required(context.params.key, 'a parameter key in the path'),
        'the parameter key',
      );
      const body = await context.json(CorrectionBody, 'a correction');
      const part = requirePart(opened, mpn);
      const before = part.parameters[key];
      const corrected = {
        value: body.value,
        // A person who read the page is a verification of a kind the model
        // cannot perform, so the value carries their note and their name.
        provenance: {
          source: 'human',
          note: body.note,
          recordedAt: deps.clock().toISOString(),
        },
        confidence: 'verified',
      };
      const { event, result } = auditor.around(
        opened,
        {
          actor: body.actor,
          action: 'parameter.correct',
          targetKind: 'parameter',
          targetId: `${mpn}:${key}`,
          reason: body.reason,
          before,
        },
        () => {
          const stored = opened.repositories.parts.upsertPart(withParameter(part, key, corrected));
          return { after: stored.parameters[key], result: stored };
        },
      );
      context.respond.json(context.response, context.facts, {
        event,
        parameter: result.parameters[key],
      });
    }),
  );

  router.post(
    '/api/parts/:mpn/status',
    write(async (context) => {
      const opened = await writable(context);
      const mpn = required(context.params.mpn, 'a part number in the path');
      const body = await context.json(StatusBody, 'a status change');
      const part = requirePart(opened, mpn);
      const { event, result } = auditor.around(
        opened,
        {
          actor: body.actor,
          action: 'part.status',
          targetKind: 'part',
          targetId: mpn,
          reason: body.reason,
          before: part.status,
        },
        () => {
          const stored = opened.repositories.parts.upsertPart({ ...part, status: body.status });
          return { after: stored.status, result: stored };
        },
      );
      context.respond.json(context.response, context.facts, { event, status: result.status });
    }),
  );

  router.get(
    '/api/escalations',
    read(async (context) => {
      const query = parseQuery(EscalationQuery, context.query);
      const opened = await deps.sources.open(query.source);
      context.respond.json(context.response, context.facts, {
        escalations: opened.repositories.escalations.list({
          ...(query.mpn === undefined ? {} : { mpn: query.mpn }),
          ...(query.resolved === undefined ? {} : { resolved: query.resolved === 'true' }),
        }),
      });
    }),
  );

  router.post(
    '/api/escalations/:id/resolve',
    write(async (context) => {
      const opened = await writable(context);
      const id = required(context.params.id, 'an escalation id in the path');
      const body = await context.json(ResolveBody, 'a resolution');
      const escalation = opened.repositories.escalations.get(id);
      if (escalation === undefined) {
        throw new WebError(404, 'WEB_ESCALATION_NOT_FOUND', `no escalation ${id}`, {
          details: { id },
        });
      }
      const { event, result } = auditor.around(
        opened,
        {
          actor: body.actor,
          action: 'escalation.resolve',
          targetKind: 'escalation',
          targetId: id,
          reason: body.reason,
          before: escalation.resolution ?? null,
        },
        () => {
          const resolved = opened.repositories.escalations.resolve(id, {
            answer: body.answer,
            resolvedAt: deps.clock().toISOString(),
            by: body.actor,
          });
          return { after: resolved.resolution, result: resolved };
        },
      );
      context.respond.json(context.response, context.facts, { event, escalation: result });
    }),
  );

  router.put(
    '/api/golden/:mpn',
    write(async (context) => {
      const opened = await writable(context);
      const mpn = required(context.params.mpn, 'a part number in the path');
      const body = await context.json(GoldenBody, 'a golden part');
      const golden = parseOrThrow(GoldenPart, body.part, 'GoldenPart');
      if (golden.mpn !== mpn) {
        throw new WebError(
          400,
          'WEB_GOLDEN_MPN_MISMATCH',
          `the body is for ${golden.mpn}, the path says ${mpn}`,
          { details: { path: mpn, body: golden.mpn } },
        );
      }
      const file = goldenFile(deps.goldenDir, golden.mpn);
      let before: unknown;
      try {
        before = JSON.parse(await readFile(file, 'utf8'));
      } catch {
        before = undefined;
      }
      const { event } = auditor.around(
        opened,
        {
          actor: body.actor,
          action: before === undefined ? 'golden.create' : 'golden.update',
          targetKind: 'golden',
          targetId: golden.mpn,
          reason: body.reason,
          ...(before === undefined ? {} : { before }),
        },
        () => ({ after: golden, result: golden }),
      );
      // Written after the audit row commits: a file on disk that no row
      // explains is the one state this cannot recover from.
      await writeFile(file, `${JSON.stringify(golden, null, 2)}\n`);
      context.respond.json(context.response, context.facts, { event, file, part: golden });
    }),
  );

  router.post(
    '/api/cache/purge',
    write(async (context) => {
      const opened = await writable(context);
      const body = await context.json(PurgeBody, 'a purge');
      const ref = { namespace: body.namespace, hash: body.hash };
      const existed = await deps.store.has(ref);
      if (!existed) {
        throw new WebError(
          404,
          'WEB_CACHE_ENTRY_NOT_FOUND',
          `nothing cached under ${body.namespace}/${body.hash}`,
          { details: ref },
        );
      }
      const { event } = auditor.around(
        opened,
        {
          actor: body.actor,
          action: 'cache.purge',
          targetKind: 'cache',
          targetId: `${body.namespace}/${body.hash}`,
          reason: body.reason,
          before: ref,
        },
        () => ({ result: ref }),
      );
      await deps.store.delete(ref);
      context.respond.json(context.response, context.facts, { event, purged: ref });
    }),
  );

  router.get(
    '/api/audit',
    read(async (context) => {
      const query = parseQuery(AuditQuery, context.query);
      const opened = await deps.sources.open(query.source);
      const events = opened.repositories.audit.list({
        ...(query.targetKind === undefined ? {} : { targetKind: query.targetKind }),
        ...(query.targetId === undefined ? {} : { targetId: query.targetId }),
        ...(query.action === undefined ? {} : { action: query.action }),
        ...(query.actor === undefined ? {} : { actor: query.actor }),
        limit: 1000,
      });
      context.respond.json(
        context.response,
        context.facts,
        paginate(events, query.offset, query.limit),
      );
    }),
  );
}
