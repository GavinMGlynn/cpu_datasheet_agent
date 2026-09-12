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
    const parts = await build({ token: 'a-token-worth-twenty-chars' });
    const ping = await call(parts, '/api/ping');
    expect(ping.statusCode).toBe(200);
    const health = await call(parts, '/api/health', {
      authorization: 'Bearer a-token-worth-twenty-chars',
    });
    expect(health.statusCode).toBe(200);
  });

  it('mints a token when it is given none', async () => {
    const parts = await build();
    expect(parts.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
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
    const parts = await build({ noPoppler: true, token: 'a-token-worth-twenty-chars' });
    const health = await call(parts, '/api/health', {
      authorization: 'Bearer a-token-worth-twenty-chars',
    });
    expect(JSON.parse(health.body) as unknown).toMatchObject({ poppler: { available: false } });
  });

  it('takes poppler already probed', async () => {
    const poppler = {
      binaries: { pdftotext: 'pdftotext', pdftoppm: 'pdftoppm', pdfinfo: 'pdfinfo' },
      versions: { pdftotext: '24.0', pdftoppm: '24.0', pdfinfo: '24.0' },
    };
    const parts = await build({ poppler, token: 'a-token-worth-twenty-chars' });
    const health = await call(parts, '/api/health', {
      authorization: 'Bearer a-token-worth-twenty-chars',
    });
    expect(JSON.parse(health.body) as unknown).toMatchObject({
      poppler: { available: true, versions: { pdftotext: '24.0' } },
    });
  });

  it('takes the clock, the golden directory and the version it is given', async () => {
    const goldenDir = path.join(root, 'golden');
    await mkdir(goldenDir, { recursive: true });
    const parts = await build({
      token: 'a-token-worth-twenty-chars',
      clock: () => new Date('2026-01-01T00:00:00.000Z'),
      goldenDir,
      version: '9.9.9-test',
    });
    const health = await call(parts, '/api/health', {
      authorization: 'Bearer a-token-worth-twenty-chars',
    });
    expect(JSON.parse(health.body) as unknown).toMatchObject({
      version: '9.9.9-test',
      now: '2026-01-01T00:00:00.000Z',
    });
    const golden = await call(parts, '/api/golden', {
      authorization: 'Bearer a-token-worth-twenty-chars',
    });
    expect(JSON.parse(golden.body) as unknown).toStrictEqual({ parts: [] });
  });

  it('reads the process environment when it is given none', async () => {
    vi.stubEnv('DATA_DIR', path.join(root, 'from-env'));
    vi.stubEnv('LOG_LEVEL', 'error');
    built = await createWeb({ token: 'a-token-worth-twenty-chars' });
    const sources = await call(built, '/api/sources', {
      authorization: 'Bearer a-token-worth-twenty-chars',
    });
    expect(sources.body).toContain(path.join(root, 'from-env'));
    vi.unstubAllEnvs();
  });

  it('reads evaluation results from where it is told', async () => {
    const resultsDir = path.join(root, 'results');
    await mkdir(resultsDir, { recursive: true });
    const parts = await build({ resultsDir, token: 'a-token-worth-twenty-chars' });
    const result = await call(parts, '/api/evals', {
      authorization: 'Bearer a-token-worth-twenty-chars',
    });
    expect(JSON.parse(result.body) as unknown).toStrictEqual({ results: [] });
  });

  it('takes the harness a launch will run through', async () => {
    const { query } = scriptedQuery([resultMessage({ numTurns: 1, costUsd: 0 })]);
    const parts = await build({ token: 'a-token-worth-twenty-chars', query });
    expect(parts.deps.launcher).toBeDefined();
  });

  it('reads the live store from where it is told', async () => {
    const databaseFile = path.join(root, 'elsewhere', 'chip.sqlite');
    const parts = await build({ databaseFile, token: 'a-token-worth-twenty-chars' });
    const sources = await call(parts, '/api/sources', {
      authorization: 'Bearer a-token-worth-twenty-chars',
    });
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
