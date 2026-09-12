import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Cache, FileCacheStore } from '../../src/cache/index.js';
import { loadConfig } from '../../src/config.js';
import {
  createRepositories,
  openDatabase,
  type Db,
  type Repositories,
} from '../../src/db/index.js';
import { createRedactor } from '../../src/log/redact.js';
import { PdfToolkit, popplerPreflight, type PdfRef } from '../../src/pdf/index.js';
import type { ApiDeps } from '../../src/web/api/deps.js';
import type { QueryFn } from '../../src/agent/execute.js';
import { createAuditor } from '../../src/web/audit.js';
import { createLauncher } from '../../src/web/runs/launcher.js';
import { createLaunchRegistry } from '../../src/web/runs/registry.js';
import { createEvals } from '../../src/web/data/evals.js';
import { createLedgerIndex } from '../../src/web/data/ledger-index.js';
import { createSources, type Sources } from '../../src/web/data/sources.js';
import { createAuthService, type AuthService } from '../../src/auth/service.js';
import { createAuthStore } from '../../src/auth/store.js';
import type { Account } from '../../src/auth/account.js';
import type { IssuedSession } from '../../src/auth/sessions.js';
import {
  createApp,
  type HttpRequestLike,
  type ResponseSink,
  type RouteEntry,
} from '../../src/web/server/app.js';
import { createResponder } from '../../src/web/server/respond.js';
import { Router } from '../../src/web/server/router.js';
import { createSecurity, originsFor } from '../../src/web/server/security.js';
import { buildPdf, datasheetSpec } from './pdf-fixtures.js';
import { capturedLogger, recordedRequest, recordedResponse } from './web.js';

/** The account every test signs in as, unless it asks for another. */
export const TEST_USER = 'tester';

export interface ApiResult {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | readonly string[]>>;
  readonly body: unknown;
  readonly text: string;
}

export interface TestApi {
  /** The identity service the app was built with. */
  readonly auth: AuthService;
  /** The two accounts every test has: one of each role. */
  readonly accounts: { readonly admin: Account; readonly viewer: Account };
  /** The session the requests carry. */
  readonly session: IssuedSession;
  /** Signs in as the other role, and returns the session that follows. */
  signInAs(role: 'admin' | 'viewer'): IssuedSession;
  /** A request with exactly the headers given: for testing who is refused. */
  requestAs(
    headers: Record<string, string>,
    method: string,
    url: string,
    body?: unknown,
  ): Promise<ApiResult>;
  readonly root: string;
  readonly deps: ApiDeps;
  readonly db: Db;
  readonly repositories: Repositories;
  readonly sources: Sources;
  readonly router: Router<RouteEntry>;
  /** The request handler itself, for tests that need a raw request or a stream. */
  readonly app: (request: HttpRequestLike, response: ResponseSink) => Promise<void>;
  readonly logLines: Record<string, unknown>[];
  request(method: string, url: string, body?: unknown): Promise<ApiResult>;
  get(url: string): Promise<ApiResult>;
  post(url: string, body?: unknown): Promise<ApiResult>;
  /** Writes a PDF fixture into the cache store and returns its reference. */
  addDatasheet(): Promise<PdfRef & { pageCount: number; url: string }>;
  /** Appends ledger records, as the ledger itself would. */
  appendLedger(records: readonly unknown[], day?: string): Promise<void>;
  /** Writes a blob beside the ledger, for an output too large to inline. */
  writeBlob(relative: string, content: string): Promise<void>;
  close(): Promise<void>;
}

export interface TestApiOptions {
  /** Registers the routes under test. */
  readonly register: (router: Router<RouteEntry>, deps: ApiDeps) => void;
  /** Where evaluation results are read from. Defaults to a temp directory. */
  readonly resultsDir?: string;
  readonly goldenDir?: string;
  /** Extra environment for `loadConfig`, to give the API credentials to report on. */
  readonly env?: Readonly<Record<string, string>>;
  /** False stands in for a runner with no poppler installed. */
  readonly poppler?: boolean;
  /** A scripted harness, so a launch can be tested without spending anything. */
  readonly query?: QueryFn;
}

/**
 * An API under test: temporary data directory, real SQLite, real cache store,
 * a real PDF toolkit over poppler, and a fake socket.
 *
 * Nothing is mocked that the site does not mock itself. The point of these
 * tests is that the endpoints work against the same components the server
 * runs with.
 */
export async function createTestApi(options: TestApiOptions): Promise<TestApi> {
  const root = await mkdtemp(path.join(tmpdir(), 'chip-web-api-'));
  const dataDir = path.join(root, 'data');
  const cacheDir = path.join(dataDir, 'cache');
  const ledgerDir = path.join(dataDir, 'ledger');
  const evalRunsDir = path.join(dataDir, 'eval-runs');
  const resultsDir = options.resultsDir ?? path.join(root, 'results');
  await mkdir(ledgerDir, { recursive: true });
  await mkdir(evalRunsDir, { recursive: true });
  await mkdir(resultsDir, { recursive: true });

  const databaseFile = path.join(dataDir, 'chip.sqlite');
  const db = openDatabase(databaseFile);
  const repositories = createRepositories(db);
  const sources = createSources({ databaseFile, evalRunsDir });
  const store = new FileCacheStore(cacheDir);
  const cache = new Cache({ store });
  const pdf = new PdfToolkit({ cache, store, tools: await popplerPreflight() });
  const config = loadConfig({ DATA_DIR: dataDir, ...options.env });
  const log = capturedLogger();
  const ledger = createLedgerIndex(ledgerDir);

  let auditIds = 0;
  let launchIds = 0;
  const launches = createLaunchRegistry({
    clock: () => new Date('2026-09-12T00:00:00.000Z'),
    newId: () => `00000000-0000-4000-a000-${String((launchIds += 1)).padStart(12, '0')}`,
  });
  const authStore = createAuthStore(path.join(root, 'auth.sqlite'));
  const auth = createAuthService({
    store: authStore,
    clock: () => new Date('2026-09-12T00:00:00.000Z'),
  });
  const tester = authStore.accounts.create(
    { username: TEST_USER, role: 'admin' },
    '2026-09-12T00:00:00.000Z',
  );
  const viewer = authStore.accounts.create(
    { username: 'onlooker', role: 'viewer' },
    '2026-09-12T00:00:00.000Z',
  );
  // Signed in directly: a password would cost a scrypt hash in every test,
  // and what is being tested here is what a signed-in caller may do.
  let session = auth.signInAs(tester);

  const deps: ApiDeps = {
    sources,
    auth,
    oidc: undefined,
    launches,
    launcher: createLauncher({
      config,
      registry: launches,
      logger: log.logger,
      databasePath: databaseFile,
      ...(options.query === undefined ? {} : { query: options.query }),
    }),
    auditor: createAuditor({
      clock: () => new Date('2026-09-12T00:00:00.000Z'),
      newId: () => `00000000-0000-4000-9000-${String((auditIds += 1)).padStart(12, '0')}`,
    }),
    evals: createEvals({
      resultsDir,
      ...(options.goldenDir === undefined ? {} : { goldenDir: options.goldenDir }),
    }),
    ledger,
    pdf,
    store,
    config,
    logger: log.logger,
    clock: () => new Date('2026-09-12T00:00:00.000Z'),
    poppler: options.poppler === false ? undefined : await popplerPreflight(),
    ledgerDir,
    cacheDir,
    goldenDir: options.goldenDir ?? 'eval/golden',
    version: '1.0.0-test',
  };

  const router = new Router<RouteEntry>();
  options.register(router, deps);
  const redact = createRedactor({});
  const app = createApp({
    router,
    responder: createResponder(redact),
    security: createSecurity({ auth, origins: originsFor('127.0.0.1', 5174) }),
    logger: log.logger,
    redact,
  });

  const requestWith = async (
    headers: Record<string, string>,
    method: string,
    url: string,
    body?: unknown,
  ): Promise<ApiResult> => {
    const response = recordedResponse();
    await app(
      recordedRequest({
        method,
        url,
        headers: {
          ...headers,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      response,
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.body === '' ? 'null' : response.body);
    } catch {
      parsed = undefined;
    }
    return {
      status: response.statusCode,
      headers: response.headers,
      body: parsed,
      text: response.body,
    };
  };

  const request = (method: string, url: string, body?: unknown): Promise<ApiResult> =>
    requestWith(
      { cookie: `chip_session=${session.cookie}`, 'x-chip-token': session.csrf },
      method,
      url,
      body,
    );

  return {
    root,
    deps,
    auth,
    accounts: { admin: tester, viewer },
    get session() {
      return session;
    },
    signInAs(role: 'admin' | 'viewer') {
      session = auth.signInAs(role === 'admin' ? tester : viewer);
      return session;
    },
    requestAs: (headers, method, url, body) => requestWith(headers, method, url, body),
    db,
    repositories,
    sources,
    router,
    app,
    logLines: log.lines,
    request,
    get: (url) => request('GET', url),
    post: (url, body) => request('POST', url, body ?? {}),

    async addDatasheet() {
      const bytes = await buildPdf(datasheetSpec());
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const localPath = path.join(dataDir, 'pdfs', `${sha256}.pdf`);
      await mkdir(path.dirname(localPath), { recursive: true });
      await writeFile(localPath, bytes);
      return {
        sha256,
        localPath,
        pageCount: datasheetSpec().pages.length,
        url: 'https://example.invalid/datasheet.pdf',
      };
    },

    async appendLedger(records, day = '2026-09-11') {
      const file = path.join(ledgerDir, `${day}.jsonl`);
      const lines = records.map((record) => `${JSON.stringify(record)}\n`).join('');
      await appendFile(file, lines);
      await ledger.refresh();
    },

    async writeBlob(relative, content) {
      const file = path.join(ledgerDir, relative);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content);
    },

    async close() {
      sources.close();
      authStore.close();
      db.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** Writes a file under the temp root, for tests that need one on disk. */
export async function writeUnder(root: string, relative: string, content: string): Promise<string> {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  return file;
}
