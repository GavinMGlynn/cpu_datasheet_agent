import path from 'node:path';
import { access, constants } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { QueryFn } from '../agent/execute.js';
import { Cache, FileCacheStore } from '../cache/index.js';
import { loadConfig, type Config } from '../config.js';
import { createLogger, type Logger } from '../log/logger.js';
import { createRedactor, secretsFromConfig } from '../log/redact.js';
import { PdfToolkit, popplerPreflight, type PopplerTools } from '../pdf/index.js';
import { registerApi, type ApiDeps } from './api/index.js';
import { createAuditor } from './audit.js';
import { createLauncher } from './runs/launcher.js';
import { createLaunchRegistry } from './runs/registry.js';
import { createEvals } from './data/evals.js';
import { GOLDEN_DIR } from '../eval/load.js';
import { createLedgerIndex } from './data/ledger-index.js';
import { createSources, type Sources } from './data/sources.js';
import {
  createApp,
  type ResponseSink,
  type RouteEntry,
  type HttpRequestLike,
} from './server/app.js';
import { WebError } from './server/errors.js';
import { createResponder } from './server/respond.js';
import { Router } from './server/router.js';
import { createSecurity, mintToken, originsFor, type Security } from './server/security.js';
import { createStaticHandler, tradeTokenForCookie } from './server/static.js';

/** Where the built front end is looked for, relative to this file's package. */
export const UI_DIR = fileURLToPath(new URL('../../dist/ui/', import.meta.url));

export interface WebOptions {
  /** Environment the configuration is read from. Defaults to the process's. */
  readonly env?: NodeJS.ProcessEnv;
  /** Overrides the data directory the configuration names. */
  readonly dataDir?: string;
  /** The live store. Defaults to `chip.sqlite` in the data directory. */
  readonly databaseFile?: string;
  /** Where the built front end lives. */
  readonly uiDir?: string;
  /** Where evaluation results are read from. */
  readonly resultsDir?: string;
  /** Where the golden files live. */
  readonly goldenDir?: string;
  readonly port?: number;
  readonly host?: string;
  /** A token to use instead of minting one, so a restart can keep a session. */
  readonly token?: string;
  readonly version?: string;
  readonly logger?: Logger;
  readonly clock?: () => Date;
  /** Poppler, already probed. Defaults to probing the machine. */
  readonly poppler?: PopplerTools;
  /** Treat poppler as absent without probing, for testing that path. */
  readonly noPoppler?: boolean;
  /** The harness runs are executed through. Defaults to the real one. */
  readonly query?: QueryFn;
}

export interface WebParts {
  readonly deps: ApiDeps;
  readonly sources: Sources;
  readonly security: Security;
  readonly token: string;
  readonly config: Config;
  readonly app: (request: HttpRequestLike, response: ResponseSink) => Promise<void>;
  readonly router: Router<RouteEntry>;
  close(): void;
}

/**
 * The shape the toolkit needs when poppler is not installed.
 *
 * The names are right and the binaries are absent, so a call fails at spawn
 * rather than at construction. Nothing reaches that point in practice: the
 * datasheet endpoints refuse with 503 first, and health says so plainly.
 */
const POPPLER_ABSENT: PopplerTools = {
  binaries: { pdftotext: 'pdftotext', pdftoppm: 'pdftoppm', pdfinfo: 'pdfinfo' },
  versions: { pdftotext: 'not installed', pdftoppm: 'not installed', pdfinfo: 'not installed' },
};

/** Probes poppler, reporting absence rather than failing to start. Exported for its test. */
export async function probePoppler(): Promise<PopplerTools | undefined> {
  try {
    return await popplerPreflight();
  } catch {
    // A missing poppler stops page text and page images, and nothing else.
    // The health endpoint reports it; the rest of the site works.
    return undefined;
  }
}

async function present(dir: string): Promise<boolean> {
  try {
    await access(path.join(dir, 'index.html'), constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wires the whole site from configuration.
 *
 * Everything the API reads is built once here and shared: one database
 * connection per source, one ledger index, one PDF toolkit over the same
 * cache the agent uses. The redactor is built from the configuration's own
 * credentials, so a value that reached a response would have to get past it
 * first (D67).
 */
export async function createWeb(options: WebOptions = {}): Promise<WebParts> {
  const config = loadConfig(options.env ?? process.env);
  const dataDir = options.dataDir ?? config.dataDir;
  const token = options.token ?? mintToken();
  const port = options.port ?? 5174;
  const host = options.host ?? '127.0.0.1';
  const redact = createRedactor({ secrets: secretsFromConfig(config) });
  const logger =
    options.logger ??
    createLogger({ level: config.logLevel, fields: { name: 'chip-web' }, redact });

  const databaseFile = options.databaseFile ?? path.join(dataDir, 'chip.sqlite');
  const sources = createSources({
    databaseFile,
    evalRunsDir: path.join(dataDir, 'eval-runs'),
  });
  const cacheDir = path.join(dataDir, 'cache');
  const ledgerDir = path.join(dataDir, 'ledger');
  const store = new FileCacheStore(cacheDir);
  const poppler =
    options.noPoppler === true ? undefined : (options.poppler ?? (await probePoppler()));
  const pdf = new PdfToolkit({
    cache: new Cache({ store }),
    store,
    tools: poppler ?? POPPLER_ABSENT,
  });

  const launches = createLaunchRegistry(
    options.clock === undefined ? {} : { clock: options.clock },
  );
  const launcher = createLauncher({
    config,
    registry: launches,
    logger,
    ...(options.query === undefined ? {} : { query: options.query }),
    databasePath: databaseFile,
  });

  const deps: ApiDeps = {
    sources,
    auditor: createAuditor(options.clock === undefined ? {} : { clock: options.clock }),
    launcher,
    launches,
    evals: createEvals({
      ...(options.resultsDir === undefined ? {} : { resultsDir: options.resultsDir }),
      ...(options.goldenDir === undefined ? {} : { goldenDir: options.goldenDir }),
    }),
    ledger: createLedgerIndex(ledgerDir),
    pdf,
    store,
    config,
    logger,
    clock: options.clock ?? (() => new Date()),
    poppler,
    ledgerDir,
    cacheDir,
    goldenDir: options.goldenDir ?? GOLDEN_DIR,
    version: options.version ?? '1.0.0',
  };

  const router = new Router<RouteEntry>();
  registerApi(router, deps);

  // An unknown path under /api is a 404 from the API, not a page: without
  // this the catch-all below would answer a mistyped endpoint with the
  // application shell, which looks like the endpoint working.
  router.get('/api/*path', {
    access: 'read',
    handler: (context) => {
      throw new WebError(404, 'WEB_NOT_FOUND', `nothing is served at ${context.url.pathname}`);
    },
  });

  const uiDir = options.uiDir ?? UI_DIR;
  const built = await present(uiDir);
  const serveUi = createStaticHandler({ dir: uiDir });
  router.get('/*path', {
    access: 'open',
    handler: async (context) => {
      // Signing in has to work before the front end exists, or a fresh
      // checkout has no way in at all.
      if (tradeTokenForCookie(context)) {
        return;
      }
      if (!built) {
        throw new WebError(
          503,
          'WEB_UI_NOT_BUILT',
          `the front end is not built: no index.html under ${uiDir}. Run \`npm run build:ui\`.`,
          { details: { uiDir } },
        );
      }
      await serveUi(context);
    },
  });

  const security = createSecurity({ token, origins: originsFor(host, port) });
  const app = createApp({
    router,
    responder: createResponder(redact),
    security,
    logger,
    redact,
  });

  return {
    deps,
    sources,
    security,
    token,
    config,
    app,
    router,
    close() {
      sources.close();
    },
  };
}
