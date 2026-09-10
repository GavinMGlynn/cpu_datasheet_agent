import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { jsonBody, networkError, onPost, statusBody, textBody } from '../../../test/helpers/msw.js';
import type { DigiKeyError } from './errors.js';
import {
  DEFAULT_REFRESH_MARGIN_MS,
  DigiKeyTokenClient,
  FileTokenStore,
  MemoryTokenStore,
  PRODUCTION_HOST,
  SANDBOX_HOST,
  TOKEN_PATH,
  fingerprint,
  type StoredToken,
} from './token.js';

const server = setupServer();
const PROD_TOKEN_URL = `${PRODUCTION_HOST}${TOKEN_PATH}`;
const SANDBOX_TOKEN_URL = `${SANDBOX_HOST}${TOKEN_PATH}`;
const T0 = Date.parse('2026-09-10T10:00:00Z');

let now: number;
let calls: number;
let dir: string;

function tokenServer(token = 'tok-1', expiresIn = 600): void {
  server.use(
    onPost(PROD_TOKEN_URL, () => {
      calls += 1;
      return jsonBody({
        access_token: `${token}-${String(calls)}`,
        expires_in: expiresIn,
        token_type: 'Bearer',
      });
    }),
  );
}

function client(
  overrides: Partial<ConstructorParameters<typeof DigiKeyTokenClient>[0]> = {},
): DigiKeyTokenClient {
  return new DigiKeyTokenClient({
    clientId: 'id-abc',
    clientSecret: 'secret-xyz',
    clock: () => new Date(now),
    ...overrides,
  });
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterAll(() => {
  server.close();
});

beforeEach(async () => {
  server.resetHandlers();
  now = T0;
  calls = 0;
  dir = await mkdtemp(path.join(tmpdir(), 'dk-token-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('credentials', () => {
  it.each([
    ['neither', { clientId: undefined, clientSecret: undefined }],
    ['no id', { clientId: undefined }],
    ['no secret', { clientSecret: undefined }],
  ])('refuses to run with %s configured', async (_label, overrides) => {
    await expect(client(overrides).getToken()).rejects.toMatchObject({
      code: 'DIGIKEY_CREDENTIALS_MISSING',
    });
  });

  it('names which half is missing without revealing either', async () => {
    try {
      await client({ clientSecret: undefined }).getToken();
    } catch (error) {
      const failure = error as DigiKeyError;
      expect(failure.details).toEqual({ hasClientId: true, hasClientSecret: false });
      expect(JSON.stringify(failure.details)).not.toContain('id-abc');
    }
  });
});

describe('host selection', () => {
  it('uses production by default and sandbox when asked', () => {
    expect(client().host).toBe(PRODUCTION_HOST);
    expect(client({ sandbox: true }).host).toBe(SANDBOX_HOST);
  });

  it('requests from the sandbox host when configured', async () => {
    server.use(
      onPost(SANDBOX_TOKEN_URL, () => {
        calls += 1;
        return jsonBody({ access_token: 'sandbox-token', expires_in: 600, token_type: 'Bearer' });
      }),
    );

    await expect(client({ sandbox: true }).getToken()).resolves.toBe('sandbox-token');
    expect(calls).toBe(1);
  });
});

describe('token lifecycle', () => {
  it('requests a token and sends the credentials as form data', async () => {
    let body = '';
    let contentType: string | null = null;
    server.use(
      onPost(PROD_TOKEN_URL, async (request) => {
        contentType = request.headers.get('content-type');
        body = await request.text();
        return jsonBody({ access_token: 'tok', expires_in: 600, token_type: 'Bearer' });
      }),
    );

    await expect(client().getToken()).resolves.toBe('tok');

    expect(contentType).toContain('application/x-www-form-urlencoded');
    expect(new URLSearchParams(body).get('grant_type')).toBe('client_credentials');
    expect(new URLSearchParams(body).get('client_id')).toBe('id-abc');
    expect(new URLSearchParams(body).get('client_secret')).toBe('secret-xyz');
  });

  it('reuses a cached token while it is fresh', async () => {
    tokenServer();
    const tokens = client({ store: new MemoryTokenStore() });

    const first = await tokens.getToken();
    now += 60_000;
    const second = await tokens.getToken();

    expect(second).toBe(first);
    expect(calls).toBe(1);
  });

  it('refreshes before expiry rather than after it', async () => {
    tokenServer();
    const tokens = client({ store: new MemoryTokenStore() });
    await tokens.getToken();

    // Still outside the margin.
    now = T0 + (600 - 61) * 1000;
    await tokens.getToken();
    expect(calls).toBe(1);

    // Inside the margin, but the token has not expired yet.
    now = T0 + (600 - 59) * 1000;
    await tokens.getToken();
    expect(calls).toBe(2);
    expect(DEFAULT_REFRESH_MARGIN_MS).toBe(60_000);
  });

  it('honours a custom refresh margin', async () => {
    tokenServer();
    const tokens = client({ store: new MemoryTokenStore(), refreshMarginMs: 300_000 });
    await tokens.getToken();

    now = T0 + 301_000;
    await tokens.getToken();

    expect(calls).toBe(2);
  });

  it('refetches when forced', async () => {
    tokenServer();
    const tokens = client({ store: new MemoryTokenStore() });
    const first = await tokens.getToken();

    const forced = await tokens.getToken(true);

    expect(forced).not.toBe(first);
    expect(calls).toBe(2);
  });

  it('shares one request between concurrent callers', async () => {
    tokenServer();
    const tokens = client({ store: new MemoryTokenStore() });

    const results = await Promise.all([tokens.getToken(), tokens.getToken(), tokens.getToken()]);

    expect(new Set(results).size).toBe(1);
    expect(calls).toBe(1);
  });

  it('discards a token issued for different credentials', async () => {
    tokenServer();
    const store = new MemoryTokenStore();
    await store.write({
      accessToken: 'stale',
      expiresAt: new Date(T0 + 600_000).toISOString(),
      clientFingerprint: fingerprint('someone-else'),
    });

    await expect(client({ store }).getToken()).resolves.not.toBe('stale');
    expect(calls).toBe(1);
  });

  it('records an expiry derived from the reported lifetime', async () => {
    tokenServer('tok', 599);
    const store = new MemoryTokenStore();
    await client({ store }).getToken();

    await expect(store.read()).resolves.toMatchObject({
      expiresAt: new Date(T0 + 599_000).toISOString(),
      clientFingerprint: fingerprint('id-abc'),
    });
  });
});

describe('token endpoint failures', () => {
  it('reports a rejected credential pair with the status', async () => {
    server.use(onPost(PROD_TOKEN_URL, () => statusBody(401)));

    await expect(client().getToken()).rejects.toMatchObject({
      code: 'DIGIKEY_TOKEN_FAILED',
      details: { status: 401 },
    });
  });

  it('reports a body that is not JSON', async () => {
    server.use(onPost(PROD_TOKEN_URL, () => textBody('<html>gateway</html>')));

    await expect(client().getToken()).rejects.toMatchObject({ code: 'DIGIKEY_TOKEN_FAILED' });
  });

  it('reports a body with an unexpected shape', async () => {
    server.use(onPost(PROD_TOKEN_URL, () => jsonBody({ token: 'wrong-field' })));

    await expect(client().getToken()).rejects.toMatchObject({ code: 'DIGIKEY_TOKEN_FAILED' });
  });

  it('reports an unreachable endpoint and keeps the cause', async () => {
    server.use(onPost(PROD_TOKEN_URL, () => networkError()));

    await expect(client().getToken()).rejects.toMatchObject({ code: 'DIGIKEY_TOKEN_FAILED' });
    try {
      await client().getToken();
    } catch (error) {
      expect((error as DigiKeyError).cause).toBeInstanceOf(Error);
    }
  });

  it('lets a later call try again after a failure', async () => {
    let attempt = 0;
    server.use(
      onPost(PROD_TOKEN_URL, () => {
        attempt += 1;
        return attempt === 1
          ? statusBody(500)
          : jsonBody({ access_token: 'recovered', expires_in: 600, token_type: 'Bearer' });
      }),
    );
    const tokens = client({ store: new MemoryTokenStore() });

    await expect(tokens.getToken()).rejects.toMatchObject({ code: 'DIGIKEY_TOKEN_FAILED' });
    await expect(tokens.getToken()).resolves.toBe('recovered');
  });
});

describe('MemoryTokenStore', () => {
  it('starts empty and remembers what it is given', async () => {
    const store = new MemoryTokenStore();
    await expect(store.read()).resolves.toBeUndefined();

    const token: StoredToken = {
      accessToken: 'a',
      expiresAt: '2026-09-10T10:10:00Z',
      clientFingerprint: fingerprint('id-abc'),
    };
    await store.write(token);

    await expect(store.read()).resolves.toEqual(token);
  });
});

describe('FileTokenStore', () => {
  const token: StoredToken = {
    accessToken: 'file-token',
    expiresAt: '2026-09-10T10:10:00Z',
    clientFingerprint: fingerprint('id-abc'),
  };

  it('writes the token readable only by its owner and reads it back', async () => {
    const file = path.join(dir, 'tokens', 'digikey.json');
    const store = new FileTokenStore(file);

    await store.write(token);

    await expect(store.read()).resolves.toEqual(token);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('treats a missing file as no token', async () => {
    await expect(new FileTokenStore(path.join(dir, 'absent.json')).read()).resolves.toBeUndefined();
  });

  it('treats an unparseable or invalid file as no token', async () => {
    const file = path.join(dir, 'broken.json');
    const store = new FileTokenStore(file);

    await writeFile(file, '{not json', 'utf8');
    await expect(store.read()).resolves.toBeUndefined();

    await writeFile(file, JSON.stringify({ accessToken: 'x' }), 'utf8');
    await expect(store.read()).resolves.toBeUndefined();
  });

  it('survives a full round trip through the client', async () => {
    tokenServer();
    const file = path.join(dir, 'tokens', 'digikey.json');
    await client({ store: new FileTokenStore(file) }).getToken();

    const second = client({ store: new FileTokenStore(file) });
    await second.getToken();

    expect(calls).toBe(1);
    expect(await readFile(file, 'utf8')).toContain('accessToken');
  });
});

describe('clientId', () => {
  it('exposes the configured id and refuses when there is none', () => {
    expect(client().clientId).toBe('id-abc');
    expect(() => client({ clientId: undefined }).clientId).toThrow(/DIGIKEY_CLIENT_ID/);
  });
});

describe('fingerprint', () => {
  it('is stable, short, and does not contain the credential', () => {
    expect(fingerprint('id-abc')).toBe(fingerprint('id-abc'));
    expect(fingerprint('id-abc')).toHaveLength(16);
    expect(fingerprint('id-abc')).not.toContain('id-abc');
    expect(fingerprint('id-abc')).not.toBe(fingerprint('id-abd'));
  });
});
