import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  datasheet as datasheetFixture,
  part as partFixture,
  toolCallRecord,
} from '../helpers/core-fixtures.js';
import { buildPdf, datasheetSpec } from '../helpers/pdf-fixtures.js';
import { createRepositories, openDatabase } from '../../src/db/index.js';
import { serveWeb, type ServeResult } from '../../src/web/cli.js';

/**
 * The site as it actually runs: a real socket, a real SQLite file, a real
 * ledger on disk, and a real PDF read by poppler. Nothing here is faked, and
 * every request goes over HTTP.
 */

let root: string;
let dataDir: string;
let running: ServeResult;
let sha256: string;

function url(pathname: string): string {
  return `${running.server.url}${pathname}`;
}

function withToken(headers: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${running.token}`, ...headers };
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'chip-web-integration-'));
  dataDir = path.join(root, 'data');
  await mkdir(path.join(dataDir, 'ledger'), { recursive: true });

  const bytes = await buildPdf(datasheetSpec());
  sha256 = createHash('sha256').update(bytes).digest('hex');
  const localPath = path.join(dataDir, 'pdfs', `${sha256}.pdf`);
  await mkdir(path.dirname(localPath), { recursive: true });
  await writeFile(localPath, bytes);

  const db = openDatabase(path.join(dataDir, 'chip.sqlite'));
  const repositories = createRepositories(db);
  repositories.datasheets.record(
    datasheetFixture({
      sha256,
      url: 'https://example.invalid/xyz54331.pdf',
      pageCount: datasheetSpec().pages.length,
      localPath,
      coversMpns: ['XYZ54331DR'],
    }),
  );
  repositories.parts.upsertPart(partFixture({ datasheet: undefined, parameters: humanRead() }));
  db.close();

  await writeFile(
    path.join(dataDir, 'ledger', '2026-09-11.jsonl'),
    `${JSON.stringify(
      toolCallRecord({ id: '00000000-0000-4000-8000-000000000001', sessionId: 'session-a' }),
    )}\n`,
  );

  running = await serveWeb(
    { help: false, port: 0, dataDir, uiDir: path.join(root, 'ui') },
    { DATA_DIR: dataDir },
    () => undefined,
  );
});

afterAll(async () => {
  await running.close();
  await rm(root, { recursive: true, force: true });
});

/** Every parameter entered by hand, so the part needs no datasheet. */
function humanRead(): Record<string, unknown> {
  const parameters = partFixture().parameters as Record<string, Record<string, unknown>>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parameters)) {
    out[key] = {
      ...value,
      provenance: {
        source: 'human',
        note: 'entered for the test',
        recordedAt: '2026-09-10T00:00:00Z',
      },
    };
  }
  return out;
}

describe('reaching the site', () => {
  it('answers a ping without a token and refuses data without one', async () => {
    const ping = await fetch(url('/api/ping'));
    expect(ping.status).toBe(200);
    expect(await ping.json()).toMatchObject({ ok: true, authenticated: false });
    const refused = await fetch(url('/api/parts'));
    expect(refused.status).toBe(401);
    expect(await refused.json()).toMatchObject({ error: { code: 'WEB_UNAUTHENTICATED' } });
  });

  it('trades the token in the address for a cookie', async () => {
    const response = await fetch(url(`/?token=${running.token}`), { redirect: 'manual' });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/');
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('chip_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');

    const withCookie = await fetch(url('/api/parts'), {
      headers: { cookie: cookie.split(';')[0] ?? '' },
    });
    expect(withCookie.status).toBe(200);
  });

  it('says the front end is not built rather than serving nothing', async () => {
    const response = await fetch(url('/'));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'WEB_UI_NOT_BUILT' } });
  });
});

describe('reading real data over HTTP', () => {
  it('lists the parts in the store', async () => {
    const response = await fetch(url('/api/parts'), { headers: withToken() });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const body = (await response.json()) as { total: number; items: { mpn: string }[] };
    expect(body.total).toBe(1);
    expect(body.items[0]?.mpn).toBe('TPS54331DR');
  });

  it('answers a conditional request with 304', async () => {
    const first = await fetch(url('/api/parts'), { headers: withToken() });
    const etag = first.headers.get('etag') ?? '';
    expect(etag).not.toBe('');
    const second = await fetch(url('/api/parts'), {
      headers: withToken({ 'if-none-match': etag }),
    });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
  });

  it('answers HEAD with the headers and no body', async () => {
    const response = await fetch(url('/api/parts'), { method: 'HEAD', headers: withToken() });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).not.toBe(null);
    expect(await response.text()).toBe('');
  });

  it('renders a datasheet page as a PNG through poppler', async () => {
    const response = await fetch(url(`/api/datasheets/${sha256}/pages/1/image?dpi=72`), {
      headers: withToken(),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(1000);
    // The PNG signature, so this is an image rather than an error page.
    expect([...bytes.slice(0, 4)]).toStrictEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('reads the ledger from disk', async () => {
    const response = await fetch(url('/api/ledger'), { headers: withToken() });
    const body = (await response.json()) as { total: number };
    expect(body.total).toBe(1);
  });

  it('reports its own health', async () => {
    const response = await fetch(url('/api/health'), { headers: withToken() });
    const body = (await response.json()) as {
      database: { totals: { parts: number } };
      credentials: Record<string, boolean>;
    };
    expect(body.database.totals.parts).toBe(1);
    expect(Object.values(body.credentials).every((value) => typeof value === 'boolean')).toBe(true);
  });

  it('serves many requests at once', async () => {
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => fetch(url('/api/parts'), { headers: withToken() })),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
  });
});

describe('refusing what it should', () => {
  it('405s a method the route does not serve, and names what it does', async () => {
    const response = await fetch(url('/api/parts'), { method: 'DELETE', headers: withToken() });
    expect(response.status).toBe(405);
    expect(await response.json()).toMatchObject({
      error: { code: 'WEB_METHOD_NOT_ALLOWED', details: { allow: ['GET', 'HEAD'] } },
    });
  });

  it('answers OPTIONS with the methods allowed', async () => {
    const response = await fetch(url('/api/parts'), { method: 'OPTIONS', headers: withToken() });
    expect(response.status).toBe(204);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });

  it('404s a path it does not serve under /api', async () => {
    const response = await fetch(url('/api/nothing'), { headers: withToken() });
    expect(response.status).toBe(404);
  });

  it('refuses a token that is not the one it minted', async () => {
    const response = await fetch(url('/api/parts'), {
      headers: { authorization: 'Bearer not-the-token' },
    });
    expect(response.status).toBe(401);
  });
});
