import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resultMessage, scriptedQuery } from '../../test/helpers/agent-sdk.js';
import { recordedRequest, recordedResponse } from '../../test/helpers/web.js';
import { createWeb, probePoppler, type WebParts } from './create.js';

let root: string;
let built: WebParts | undefined;

async function build(options: Parameters<typeof createWeb>[0] = {}): Promise<WebParts> {
  built = await createWeb({
    env: { DATA_DIR: path.join(root, 'data'), LOG_LEVEL: 'error' },
    ...options,
  });
  return built;
}

async function call(parts: WebParts, url: string, headers: Record<string, string> = {}) {
  const response = recordedResponse();
  await parts.app(recordedRequest({ url, headers }), response);
  return response;
}

/**
 * An admin account and a session for it, the way a person would have one.
 * Called more than once against the same site, so the account is reused.
 */
function signIn(parts: WebParts): Record<string, string> {
  const accounts = parts.auth.store.accounts;
  const account =
    accounts.byUsername('tester') ?? accounts.create({ username: 'tester', role: 'admin' });
  const issued = parts.auth.signInAs(account);
  return { cookie: `chip_session=${issued.cookie}`, 'x-chip-token': issued.csrf };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'chip-web-create-'));
});

afterEach(async () => {
  built?.close();
  built = undefined;
  await rm(root, { recursive: true, force: true });
});

describe('createWeb', () => {
  it('wires an application that answers', async () => {
    const parts = await build({});
    const ping = await call(parts, '/api/ping');
    expect(ping.statusCode).toBe(200);
    const health = await call(parts, '/api/health', signIn(parts));
    expect(health.statusCode).toBe(200);
  });

  it('opens an identity store beside the data, with nobody in it yet', async () => {
    const parts = await build();
    expect(parts.auth.accounts()).toBe(0);
    // Nothing can read anything until an account exists and signs in.
    expect((await call(parts, '/api/health')).statusCode).toBe(401);
  });

  it('offers single sign-on only when an issuer is configured', async () => {
    const without = await build();
    expect(without.deps.oidc).toBeUndefined();
    const withIssuer = await createWeb({
      dataDir: path.join(root, 'sso'),
      env: {
        DATA_DIR: path.join(root, 'sso'),
        LOG_LEVEL: 'error',
        AUTH_OIDC_ISSUER: 'https://issuer.invalid',
        AUTH_OIDC_CLIENT_ID: 'a-client-id',
        AUTH_OIDC_CLIENT_SECRET: 'a-secret',
        AUTH_OIDC_REDIRECT_URI: 'http://127.0.0.1:5174/api/auth/oidc/callback',
      },
    });
    try {
      expect(withIssuer.deps.oidc?.configured()).toBe(true);
      expect(withIssuer.deps.oidc?.label()).toBe('Sign in with issuer.invalid');
    } finally {
      withIssuer.close();
    }
  });

  it('serves the tutorial as itself, to anyone, with no session', async () => {
    const parts = await build();
    const page = await call(parts, '/tutorial');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Building an agent');
    // And the same page under its own directory, for anything it links to.
    expect((await call(parts, '/tutorial/index.html')).statusCode).toBe(200);
  });

  it('says so when the tutorial is not where it should be', async () => {
    const parts = await build({ tutorialDir: path.join(root, 'no-tutorial') });
    expect((await call(parts, '/tutorial')).statusCode).toBe(404);
  });

  it('says the front end is not built rather than 404ing the whole site', async () => {
    const parts = await build({ uiDir: path.join(root, 'nowhere') });
    const result = await call(parts, '/');
    expect(result.statusCode).toBe(503);
    expect(JSON.parse(result.body) as unknown).toMatchObject({
      error: { code: 'WEB_UI_NOT_BUILT' },
    });
  });

  it('serves the front end once it is there', async () => {
    const uiDir = path.join(root, 'ui');
    await mkdir(uiDir, { recursive: true });
    await writeFile(path.join(uiDir, 'index.html'), '<!doctype html><title>chip</title>');
    const parts = await build({ uiDir });
    const result = await call(parts, '/');
    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('<title>chip</title>');
  });

  it('runs without poppler, and says so', async () => {
    const parts = await build({ noPoppler: true });
    const health = await call(parts, '/api/health', signIn(parts));
    expect(JSON.parse(health.body) as unknown).toMatchObject({ poppler: { available: false } });
  });

  it('takes poppler already probed', async () => {
    const poppler = {
      binaries: { pdftotext: 'pdftotext', pdftoppm: 'pdftoppm', pdfinfo: 'pdfinfo' },
      versions: { pdftotext: '24.0', pdftoppm: '24.0', pdfinfo: '24.0' },
    };
    const parts = await build({ poppler });
    const health = await call(parts, '/api/health', signIn(parts));
    expect(JSON.parse(health.body) as unknown).toMatchObject({
      poppler: { available: true, versions: { pdftotext: '24.0' } },
    });
  });

  it('takes the clock, the golden directory and the version it is given', async () => {
    const goldenDir = path.join(root, 'golden');
    await mkdir(goldenDir, { recursive: true });
    const parts = await build({
      clock: () => new Date('2026-01-01T00:00:00.000Z'),
      goldenDir,
      version: '9.9.9-test',
    });
    const health = await call(parts, '/api/health', signIn(parts));
    expect(JSON.parse(health.body) as unknown).toMatchObject({
      version: '9.9.9-test',
      now: '2026-01-01T00:00:00.000Z',
    });
    const golden = await call(parts, '/api/golden', signIn(parts));
    expect(JSON.parse(golden.body) as unknown).toStrictEqual({ parts: [] });
  });

  it('reads the process environment when it is given none', async () => {
    vi.stubEnv('DATA_DIR', path.join(root, 'from-env'));
    vi.stubEnv('LOG_LEVEL', 'error');
    built = await createWeb({});
    const sources = await call(built, '/api/sources', signIn(built));
    expect(sources.body).toContain(path.join(root, 'from-env'));
    vi.unstubAllEnvs();
  });

  it('reads evaluation results from where it is told', async () => {
    const resultsDir = path.join(root, 'results');
    await mkdir(resultsDir, { recursive: true });
    const parts = await build({ resultsDir });
    const result = await call(parts, '/api/evals', signIn(parts));
    expect(JSON.parse(result.body) as unknown).toStrictEqual({ results: [] });
  });

  it('takes the harness a launch will run through', async () => {
    const { query } = scriptedQuery([resultMessage({ numTurns: 1, costUsd: 0 })]);
    const parts = await build({ query });
    expect(parts.deps.launcher).toBeDefined();
  });

  it('reads the live store from where it is told', async () => {
    const databaseFile = path.join(root, 'elsewhere', 'chip.sqlite');
    const parts = await build({ databaseFile });
    const sources = await call(parts, '/api/sources', signIn(parts));
    expect(sources.body).toContain(databaseFile);
  });
});

describe('probePoppler', () => {
  it('finds poppler on this machine', async () => {
    const found = await probePoppler();
    expect(typeof found?.binaries.pdftotext).toBe('string');
  });

  it('reports absence rather than throwing when the tools are not on the path', async () => {
    const realPath = process.env.PATH;
    process.env.PATH = path.join(root, 'empty');
    try {
      expect(await probePoppler()).toBeUndefined();
    } finally {
      process.env.PATH = realPath;
    }
  });
});
