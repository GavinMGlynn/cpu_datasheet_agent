import type { Config } from '../../config.js';
import type { Part } from '../../core/part.js';
import type { Logger } from '../../log/logger.js';
import type { FileCacheStore } from '../../cache/store.js';
import type { PdfToolkit } from '../../pdf/toolkit.js';
import type { PopplerTools } from '../../pdf/poppler.js';
import type { AuthService } from '../../auth/service.js';
import type { Oidc } from '../../auth/oidc.js';
import type { Auditor } from '../audit.js';
import type { Launcher } from '../runs/launcher.js';
import type { LaunchRegistry } from '../runs/registry.js';
import type { Evals } from '../data/evals.js';
import type { LedgerIndex } from '../data/ledger-index.js';
import type { OpenSource, Sources } from '../data/sources.js';
import type { RequestContext, RouteEntry } from '../server/app.js';
import { WebError } from '../server/errors.js';
import { SourceQuery, parseQuery } from './params.js';

/** Everything the API reads from. Assembled once at startup and shared. */
export interface ApiDeps {
  readonly sources: Sources;
  /** Who may use the site, and the sessions they hold (D75). */
  readonly auth: AuthService;
  /** Single sign-on, when an issuer is configured (20E.1). */
  readonly oidc: Oidc | undefined;
  /** The one path every change from the browser takes (D65). */
  readonly auditor: Auditor;
  /** Starts runs that spend money, behind the gates (D64). */
  readonly launcher: Launcher;
  /** What those runs are doing, for anything watching. */
  readonly launches: LaunchRegistry;
  readonly evals: Evals;
  readonly ledger: LedgerIndex;
  readonly pdf: PdfToolkit;
  readonly store: FileCacheStore;
  readonly config: Config;
  readonly logger: Logger;
  readonly clock: () => Date;
  /** Absent when poppler is not installed: the site says so rather than failing per page. */
  readonly poppler: PopplerTools | undefined;
  readonly ledgerDir: string;
  readonly cacheDir: string;
  /** Where the golden files live, for the human review pass (19D.6). */
  readonly goldenDir: string;
  readonly version: string;
}

/** A route anyone may reach: the application shell and its assets. */
export function open(handler: RouteEntry['handler']): RouteEntry {
  return { access: 'open', handler };
}

/** A route that needs the token. Every query is one. */
export function read(handler: RouteEntry['handler']): RouteEntry {
  return { access: 'read', handler };
}

/** A route that changes something or spends money. */
export function write(handler: RouteEntry['handler']): RouteEntry {
  return { access: 'write', handler };
}

/** The database this request is about, from `?source=`, defaulting to the live store. */
export function openSource(context: RequestContext, deps: ApiDeps): Promise<OpenSource> {
  const { source } = parseQuery(SourceQuery, context.query);
  return deps.sources.open(source);
}

/** As above, refusing a database that may not be written to. */
export function openWritableSource(context: RequestContext, deps: ApiDeps): Promise<OpenSource> {
  const { source } = parseQuery(SourceQuery, context.query);
  return deps.sources.requireWritable(source);
}

/** The MPN in the path, or a 404 that names it. */
export function requirePart(opened: OpenSource, mpn: string): Part {
  const part = opened.repositories.parts.getPart(mpn);
  if (part === undefined) {
    throw new WebError(404, 'WEB_PART_NOT_FOUND', `${mpn} is not stored in ${opened.source.id}`, {
      details: { mpn, source: opened.source.id },
    });
  }
  return part;
}
