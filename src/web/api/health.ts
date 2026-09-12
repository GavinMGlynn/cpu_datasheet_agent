import { CLASSIFICATION_AXES } from '../../core/classification.js';
import { PARAMETER_KEYS } from '../../core/parameter-keys.js';
import { PART_STATUSES } from '../../core/part.js';
import { RUN_KINDS, RUN_RESULTS } from '../../core/run.js';
import { VERDICTS } from '../../core/verification.js';
import { appliedMigrations } from '../../db/migrate.js';
import { PROMPT_DIR } from '../../agent/prompt.js';
import { readdir } from 'node:fs/promises';
import { catalogTotals } from '../data/catalog.js';
import type { RouteEntry } from '../server/app.js';
import type { Router } from '../server/router.js';
import { read, type ApiDeps } from './deps.js';
import { parseQuery, SourceQuery } from './params.js';

/**
 * Readiness, and what the vocabulary is.
 *
 * Credentials are reported as present or absent and never as values: this
 * process holds distributor and model keys, and a health page that printed
 * one would be the leak (D67).
 */

export interface CredentialState {
  readonly digikey: boolean;
  readonly mouser: boolean;
  readonly nexar: boolean;
  readonly anthropic: boolean;
}

function credentials(deps: ApiDeps): CredentialState {
  const { config } = deps;
  return {
    digikey: config.digikey.clientId !== undefined && config.digikey.clientSecret !== undefined,
    mouser: config.mouser.apiKey !== undefined,
    nexar: config.nexar.clientId !== undefined && config.nexar.clientSecret !== undefined,
    anthropic: config.anthropic.apiKey !== undefined,
  };
}

export function registerHealth(router: Router<RouteEntry>, deps: ApiDeps): void {
  router.get(
    '/api/health',
    read(async (context) => {
      const { source } = parseQuery(SourceQuery, context.query);
      const opened = await deps.sources.open(source);
      await deps.ledger.refresh();
      const totals = deps.ledger.totals();
      context.respond.json(context.response, context.facts, {
        version: deps.version,
        now: deps.clock().toISOString(),
        source: opened.source,
        credentials: credentials(deps),
        poppler:
          deps.poppler === undefined
            ? { available: false }
            : { available: true, versions: deps.poppler.versions },
        database: {
          file: opened.db.path,
          migrations: appliedMigrations(opened.db).map((migration) => migration.name),
          totals: catalogTotals(opened.repositories.parts.findParts()),
        },
        ledger: {
          dir: deps.ledgerDir,
          records: totals.records,
          malformed: totals.malformed,
          firstAt: totals.firstAt,
          lastAt: totals.lastAt,
        },
        cacheDir: deps.cacheDir,
      });
    }),
  );

  router.get(
    '/api/sources',
    read(async (context) => {
      context.respond.json(context.response, context.facts, {
        sources: await deps.sources.list(),
      });
    }),
  );

  router.get(
    '/api/meta',
    read(async (context) => {
      const prompts = (await readdir(PROMPT_DIR))
        .filter((file) => file.endsWith('.md') && file !== 'README.md')
        .map((file) => file.replace(/\.md$/u, ''))
        .sort();
      context.respond.json(context.response, context.facts, {
        version: deps.version,
        parameterKeys: PARAMETER_KEYS,
        classificationAxes: CLASSIFICATION_AXES,
        partStatuses: PART_STATUSES,
        runKinds: RUN_KINDS,
        runResults: RUN_RESULTS,
        verdicts: VERDICTS,
        prompts,
        model: deps.config.agent.model,
        effort: deps.config.agent.effort,
      });
    }),
  );

  // Used by the browser to decide whether it is signed in, and by anything
  // watching the process. Deliberately open: it says only that the server is
  // answering, which a refused request already tells you.
  router.get('/api/ping', {
    access: 'open',
    handler: (context) => {
      context.respond.json(context.response, context.facts, {
        ok: true,
        authenticated: context.auth.authenticated,
        version: deps.version,
      });
    },
  });
}
