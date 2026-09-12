import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { capturedLogger, recordedRequest, recordedResponse } from '../../../test/helpers/web.js';
import { createRedactor } from '../../log/redact.js';
import { createApp, type RouteEntry } from './app.js';
import { createResponder } from './respond.js';
import { Router } from './router.js';
import { createSecurity, originsFor, SESSION_COOKIE } from './security.js';
import { contentTypeOf, createStaticHandler, policyFor, type StaticOptions } from './static.js';

const TOKEN = 'tokentokentokentoken';
let dir: string;

function appFor(options: StaticOptions, pattern = '/*path') {
  const router = new Router<RouteEntry>().get(pattern, {
    access: 'open',
    handler: createStaticHandler(options),
  });
  const redact = createRedactor({});
  return createApp({
    router,
    responder: createResponder(redact),
    security: createSecurity({ token: TOKEN, origins: originsFor('127.0.0.1', 5174) }),
    logger: capturedLogger().logger,
    redact,
  });
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'chip-web-static-'));
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>chip</title>');
  await mkdir(path.join(dir, 'assets'), { recursive: true });
  await writeFile(path.join(dir, 'assets', 'app.0123abcd.js'), 'export const x = 1;\n');
  await writeFile(path.join(dir, 'assets', 'styles.css'), 'body { margin: 0 }\n');
  await writeFile(path.join(dir, 'notes.rtf'), 'unsupported');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('content types and cache policy', () => {
  it('maps the extensions the application is built from', () => {
    expect(contentTypeOf('app.js')).toBe('text/javascript; charset=utf-8');
    expect(contentTypeOf('page.PNG')).toBe('image/png');
  });

  it('refuses to guess at anything else', () => {
    expect(() => contentTypeOf('notes.rtf')).toThrow(
      expect.objectContaining({ code: 'WEB_UNSERVED_TYPE', status: 415 }),
    );
  });

  it('caches a hashed file for ever and a plain one not at all', () => {
    expect(policyFor('app.0123abcd.js')).toBe('asset');
    expect(policyFor('styles.css')).toBe('live');
  });
});

describe('serving', () => {
  it('serves the index at the root', async () => {
    const response = recordedResponse();
    await appFor({ dir })(recordedRequest({ url: '/' }), response);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<title>chip</title>');
    expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
  });

  it('serves an asset with the cache policy its name earns', async () => {
    const hashed = recordedResponse();
    await appFor({ dir })(recordedRequest({ url: '/assets/app.0123abcd.js' }), hashed);
    expect(hashed.headers['Cache-Control']).toBe('public, max-age=31536000, immutable');
    const plain = recordedResponse();
    await appFor({ dir })(recordedRequest({ url: '/assets/styles.css' }), plain);
    expect(plain.headers['Cache-Control']).toBe('no-cache');
  });

  it('gives a browser route the index, so a reload of a deep link works', async () => {
    const response = recordedResponse();
    await appFor({ dir })(recordedRequest({ url: '/runs/abc123' }), response);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<title>chip</title>');
  });

  it('404s a missing file that asked for a file', async () => {
    const response = recordedResponse();
    await appFor({ dir })(recordedRequest({ url: '/assets/missing.js' }), response);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'WEB_ASSET_NOT_FOUND' } });
  });

  it('refuses a path that climbs out of the directory', async () => {
    const response = recordedResponse();
    await appFor({ dir })(recordedRequest({ url: '/..%2F..%2Fetc%2Fpasswd' }), response);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'WEB_PATH_ESCAPE' } });
  });

  it('refuses a type it does not serve', async () => {
    const response = recordedResponse();
    await appFor({ dir })(recordedRequest({ url: '/notes.rtf' }), response);
    expect(response.statusCode).toBe(415);
  });

  it('treats a path through a file, or the directory itself, as a browser route', async () => {
    const throughFile = recordedResponse();
    await appFor({ dir })(recordedRequest({ url: '/assets/styles.css/deeper' }), throughFile);
    expect(throughFile.statusCode).toBe(200);
    expect(throughFile.body).toContain('<title>chip</title>');
    const root = recordedResponse();
    await appFor({ dir })(recordedRequest({ url: '/.' }), root);
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain('<title>chip</title>');
  });

  it('passes on a read failure that is not a missing file', async () => {
    const response = recordedResponse();
    const app = appFor({
      dir,
      read: () => Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' })),
    });
    await app(recordedRequest({ url: '/assets/styles.css' }), response);
    expect(response.statusCode).toBe(500);
  });
});

describe('token handoff', () => {
  it('trades a valid token in the query for a cookie and a clean URL', async () => {
    const response = recordedResponse();
    await appFor({ dir })(recordedRequest({ url: `/?token=${TOKEN}&view=costs` }), response);
    expect(response.statusCode).toBe(303);
    expect(response.headers.Location).toBe('/?view=costs');
    expect(response.headers['Set-Cookie']).toStrictEqual([
      `${SESSION_COOKIE}=${TOKEN}; Path=/; HttpOnly; SameSite=Strict`,
      `chip_csrf=${TOKEN}; Path=/; SameSite=Strict`,
    ]);
    expect(response.headers['Cache-Control']).toBe('no-store');
  });

  it('serves the page as usual when the token is wrong', async () => {
    const response = recordedResponse();
    await appFor({ dir })(recordedRequest({ url: '/?token=wrong' }), response);
    expect(response.statusCode).toBe(200);
    expect(response.headers['Set-Cookie']).toBeUndefined();
  });

  it('hands over on a deep link too', async () => {
    const response = recordedResponse();
    await appFor({ dir })(recordedRequest({ url: `/runs/abc?token=${TOKEN}` }), response);
    expect(response.statusCode).toBe(303);
    expect(response.headers.Location).toBe('/runs/abc');
  });

  it('serves the index when mounted on a route with no path parameter', async () => {
    const response = recordedResponse();
    await appFor({ dir }, '/app')(recordedRequest({ url: '/app' }), response);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<title>chip</title>');
  });

  it('serves a custom index file', async () => {
    await writeFile(path.join(dir, 'shell.html'), '<!doctype html><title>shell</title>');
    const response = recordedResponse();
    await appFor({ dir, index: 'shell.html' })(recordedRequest({ url: '/' }), response);
    expect(response.body).toContain('<title>shell</title>');
  });
});
