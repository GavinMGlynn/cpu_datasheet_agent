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
import { hashPassword } from '../../src/auth/password.js';
import type { IssuedSession } from '../../src/auth/sessions.js';
import { required } from '../../src/util/present.js';

/**
 * The site as it actually runs: a real socket, a real SQLite file, a real
 * ledger on disk, and a real PDF read by poppler. Nothing here is faked, and
 * every request goes over HTTP.
 */

let root: string;
let dataDir: string;
let running: ServeResult;
let session: IssuedSession;

const PASSWORD = 'correct horse battery staple';
let sha256: string;

function url(pathname: string): string {
  return `${running.server.url}${pathname}`;
}

/** The headers a signed-in browser sends: the session, and its own token. */
function signedIn(headers: Record<string, string> = {}): Record<string, string> {
  return { cookie: `chip_session=${session.cookie}`, 'x-chip-token': session.csrf, ...headers };
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
    { DATA_DIR: dataDir, LOG_LEVEL: 'error' },
    () => undefined,
  );
  // A real account with a real password, hashed the way the site hashes it:
  // signing in over the wire is one of the things being tested.
  running.auth.store.accounts.create({
    username: 'gavin',
    role: 'admin',
    passwordHash: await hashPassword(PASSWORD),
  });
  session = running.auth.signInAs(
    required(running.auth.store.accounts.byUsername('gavin'), 'the account just created'),
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
  it('answers a ping to anyone and refuses data to nobody in particular', async () => {
    const ping = await fetch(url('/api/ping'));
    expect(ping.status).toBe(200);
    expect(await ping.json()).toMatchObject({ ok: true, signedInAs: null });
    const refused = await fetch(url('/api/parts'));
    expect(refused.status).toBe(401);
    expect(await refused.json()).toMatchObject({ error: { code: 'WEB_UNAUTHENTICATED' } });
  });

  it('signs in with a username and a password, over the wire', async () => {
    const response = await fetch(url('/api/auth/login'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'gavin', password: PASSWORD }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      account: { username: 'gavin', role: 'admin' },
    });
    const cookies = response.headers.getSetCookie();
    expect(cookies.join(' ')).toContain('HttpOnly');
    expect(cookies.join(' ')).toContain('SameSite=Strict');
    const cookie = cookies.map((one) => one.split(';')[0]).join('; ');
    const parts = await fetch(url('/api/parts'), { headers: { cookie } });
    expect(parts.status).toBe(200);
  });

  it('refuses the wrong password without saying which half was wrong', async () => {
    const response = await fetch(url('/api/auth/login'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'gavin', password: 'not the password' }),
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('AUTH_REFUSED');
    expect(body.error.message).not.toContain('password is wrong');
  });

  it('says the front end is not built rather than serving nothing', async () => {
    const response = await fetch(url('/'));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'WEB_UI_NOT_BUILT' } });
  });
});

describe('reading real data over HTTP', () => {
  it('lists the parts in the store', async () => {
    const response = await fetch(url('/api/parts'), { headers: signedIn() });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const body = (await response.json()) as { total: number; items: { mpn: string }[] };
    expect(body.total).toBe(1);
    expect(body.items[0]?.mpn).toBe('TPS54331DR');
  });

  it('answers a conditional request with 304', async () => {
    const first = await fetch(url('/api/parts'), { headers: signedIn() });
    const etag = first.headers.get('etag') ?? '';
    expect(etag).not.toBe('');
    const second = await fetch(url('/api/parts'), {
      headers: signedIn({ 'if-none-match': etag }),
    });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
  });

  it('answers HEAD with the headers and no body', async () => {
    const response = await fetch(url('/api/parts'), { method: 'HEAD', headers: signedIn() });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).not.toBe(null);
    expect(await response.text()).toBe('');
  });

  it('renders a datasheet page as a PNG through poppler', async () => {
    const response = await fetch(url(`/api/datasheets/${sha256}/pages/1/image?dpi=72`), {
      headers: signedIn(),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(1000);
    // The PNG signature, so this is an image rather than an error page.
    expect([...bytes.slice(0, 4)]).toStrictEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('reads the ledger from disk', async () => {
    const response = await fetch(url('/api/ledger'), { headers: signedIn() });
    const body = (await response.json()) as { total: number };
    expect(body.total).toBe(1);
  });

  it('reports its own health', async () => {
    const response = await fetch(url('/api/health'), { headers: signedIn() });
    const body = (await response.json()) as {
      database: { totals: { parts: number } };
      credentials: Record<string, boolean>;
    };
    expect(body.database.totals.parts).toBe(1);
    expect(Object.values(body.credentials).every((value) => typeof value === 'boolean')).toBe(true);
  });

  it('serves many requests at once', async () => {
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => fetch(url('/api/parts'), { headers: signedIn() })),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
  });
});

describe('changing something over HTTP', () => {
  const correction = {
    actor: 'gavin',
    reason: 'read the ordering table on page 2',
    value: { value: 26, unit: 'V' },
    note: 'page 2, ordering information',
  };

  it('accepts a correction carrying the token in a header', async () => {
    const response = await fetch(url('/api/parts/TPS54331DR/parameters/vinMax'), {
      method: 'POST',
      headers: signedIn({ 'content-type': 'application/json' }),
      body: JSON.stringify(correction),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { parameter: { value: { value: number } } };
    expect(body.parameter.value.value).toBe(26);
  });

  it('refuses a correction carrying only the cookie', async () => {
    const cookie = `chip_session=${session.cookie}`;
    const refused = await fetch(url('/api/parts/TPS54331DR/parameters/vinMax'), {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(correction),
    });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({
      error: { code: 'WEB_TOKEN_HEADER_REQUIRED' },
    });

    const accepted = await fetch(url('/api/parts/TPS54331DR/parameters/vinMax'), {
      method: 'POST',
      headers: { cookie, 'x-chip-token': session.csrf, 'content-type': 'application/json' },
      body: JSON.stringify(correction),
    });
    expect(accepted.status).toBe(200);
  });

  it('refuses a correction from a viewer, whatever they carry', async () => {
    const viewer = running.auth.signInAs(
      running.auth.store.accounts.byUsername('onlooker') ??
        running.auth.store.accounts.create({ username: 'onlooker', role: 'viewer' }),
    );
    const response = await fetch(url('/api/parts/TPS54331DR/parameters/vinMax'), {
      method: 'POST',
      headers: {
        cookie: `chip_session=${viewer.cookie}`,
        'x-chip-token': viewer.csrf,
        'content-type': 'application/json',
      },
      body: JSON.stringify(correction),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'WEB_ROLE_INSUFFICIENT' } });
  });

  it('refuses a change from an origin it does not serve', async () => {
    const response = await fetch(url('/api/parts/TPS54331DR/parameters/vinMax'), {
      method: 'POST',
      headers: signedIn({ origin: 'https://evil.example', 'content-type': 'application/json' }),
      body: JSON.stringify(correction),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'WEB_ORIGIN_REFUSED' } });
  });

  it('leaves the audit trail behind every one of them', async () => {
    const response = await fetch(url('/api/audit'), { headers: signedIn() });
    const body = (await response.json()) as { total: number; items: { action: string }[] };
    expect(body.total).toBeGreaterThan(0);
    expect(body.items[0]?.action).toBe('parameter.correct');
  });
});

describe('refusing what it should', () => {
  it('405s a method the route does not serve, and names what it does', async () => {
    const response = await fetch(url('/api/parts'), { method: 'DELETE', headers: signedIn() });
    expect(response.status).toBe(405);
    expect(await response.json()).toMatchObject({
      error: { code: 'WEB_METHOD_NOT_ALLOWED', details: { allow: ['GET', 'HEAD'] } },
    });
  });

  it('answers OPTIONS with the methods allowed', async () => {
    const response = await fetch(url('/api/parts'), { method: 'OPTIONS', headers: signedIn() });
    expect(response.status).toBe(204);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });

  it('404s a path it does not serve under /api', async () => {
    const response = await fetch(url('/api/nothing'), { headers: signedIn() });
    expect(response.status).toBe(404);
  });

  it('refuses a token that is not the one it minted', async () => {
    const response = await fetch(url('/api/parts'), {
      headers: { authorization: 'Bearer not-the-token' },
    });
    expect(response.status).toBe(401);
  });
});
