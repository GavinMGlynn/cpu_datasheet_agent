import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  jsonBody,
  networkError,
  onGet,
  onPost,
  statusBody,
  textBody,
} from '../../../test/helpers/msw.js';
import { DigiKeyClient, type DigiKeyClientOptions } from './client.js';
import { MemoryTokenStore, PRODUCTION_HOST, SANDBOX_HOST, TOKEN_PATH } from './token.js';

const server = setupServer();
const TOKEN_URL = `${PRODUCTION_HOST}${TOKEN_PATH}`;
const PATH = '/products/v4/search/TPS54331DR/productdetails';
const URL = `${PRODUCTION_HOST}${PATH}`;
const Schema = z.looseObject({ ok: z.boolean() });
const T0 = Date.parse('2026-09-10T10:00:00Z');

let now: number;
let delays: number[];
let tokenCalls: number;
let apiCalls: number;

function tokenEndpoint(): void {
  server.use(
    onPost(TOKEN_URL, () => {
      tokenCalls += 1;
      return jsonBody({
        access_token: `tok-${String(tokenCalls)}`,
        expires_in: 600,
        token_type: 'Bearer',
      });
    }),
  );
}

function client(overrides: Partial<DigiKeyClientOptions> = {}): DigiKeyClient {
  return new DigiKeyClient({
    clientId: 'id-abc',
    clientSecret: 'secret-xyz',
    locale: { site: 'AU', language: 'en', currency: 'AUD' },
    tokenStore: new MemoryTokenStore(),
    clock: () => new Date(now),
    sleep: (ms) => {
      delays.push(ms);
      now += ms;
      return Promise.resolve();
    },
    ...overrides,
  });
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  server.resetHandlers();
  now = T0;
  delays = [];
  tokenCalls = 0;
  apiCalls = 0;
  tokenEndpoint();
});

describe('requests', () => {
  it('sends the bearer token, the client id, and the locale headers', async () => {
    let headers: Headers | undefined;
    server.use(
      onGet(URL, (request) => {
        headers = request.headers;
        return jsonBody({ ok: true });
      }),
    );

    await expect(client().request(Schema, { method: 'GET', path: PATH })).resolves.toEqual({
      ok: true,
    });

    expect(headers?.get('authorization')).toBe('Bearer tok-1');
    expect(headers?.get('x-digikey-client-id')).toBe('id-abc');
    expect(headers?.get('x-digikey-locale-site')).toBe('AU');
    expect(headers?.get('x-digikey-locale-language')).toBe('en');
    expect(headers?.get('x-digikey-locale-currency')).toBe('AUD');
    expect(headers?.get('accept')).toBe('application/json');
  });

  it('sends a JSON body for a POST and no content type for a GET', async () => {
    let body: unknown;
    let getContentType: string | null = null;
    server.use(
      onPost(`${PRODUCTION_HOST}/products/v4/search/keyword`, async (request) => {
        body = await request.json();
        return jsonBody({ ok: true });
      }),
      onGet(URL, (request) => {
        getContentType = request.headers.get('content-type');
        return jsonBody({ ok: true });
      }),
    );
    const api = client();

    await api.request(Schema, {
      method: 'POST',
      path: '/products/v4/search/keyword',
      body: { Keywords: 'x' },
    });
    await api.request(Schema, { method: 'GET', path: PATH });

    expect(body).toEqual({ Keywords: 'x' });
    expect(getContentType).toBeNull();
  });

  it('targets the sandbox host when configured', () => {
    expect(client().host).toBe(PRODUCTION_HOST);
    expect(client({ sandbox: true }).host).toBe(SANDBOX_HOST);
  });

  it('records the daily quota reported by the API', async () => {
    server.use(
      onGet(URL, () =>
        jsonBody(
          { ok: true },
          { headers: { 'x-ratelimit-limit': '1000', 'x-ratelimit-remaining': '993' } },
        ),
      ),
    );
    const api = client();

    expect(api.rateLimit).toEqual({
      limit: undefined,
      remaining: undefined,
      observedAt: undefined,
    });
    await api.request(Schema, { method: 'GET', path: PATH });

    expect(api.rateLimit).toEqual({
      limit: 1000,
      remaining: 993,
      observedAt: new Date(now).toISOString(),
    });
  });

  it('keeps the last known quota when a response omits the headers', async () => {
    let first = true;
    server.use(
      onGet(URL, () => {
        const headers = first ? { 'x-ratelimit-remaining': '900' } : {};
        first = false;
        return jsonBody({ ok: true }, { headers });
      }),
    );
    const api = client();

    await api.request(Schema, { method: 'GET', path: PATH });
    await api.request(Schema, { method: 'GET', path: PATH });

    expect(api.rateLimit.remaining).toBe(900);
  });
});

describe('pacing', () => {
  it('leaves a minimum gap between calls', async () => {
    server.use(onGet(URL, () => jsonBody({ ok: true })));
    const api = client({ minIntervalMs: 250 });

    await api.request(Schema, { method: 'GET', path: PATH });
    await api.request(Schema, { method: 'GET', path: PATH });

    expect(delays).toEqual([250]);
  });

  it('does not wait when enough time has already passed', async () => {
    server.use(onGet(URL, () => jsonBody({ ok: true })));
    const api = client({ minIntervalMs: 250 });

    await api.request(Schema, { method: 'GET', path: PATH });
    now += 400;
    await api.request(Schema, { method: 'GET', path: PATH });

    expect(delays).toEqual([]);
  });

  it('serialises concurrent calls rather than bursting', async () => {
    const order: number[] = [];
    server.use(
      onGet(URL, () => {
        apiCalls += 1;
        order.push(apiCalls);
        return jsonBody({ ok: true });
      }),
    );
    const api = client({ minIntervalMs: 100 });

    await Promise.all([
      api.request(Schema, { method: 'GET', path: PATH }),
      api.request(Schema, { method: 'GET', path: PATH }),
      api.request(Schema, { method: 'GET', path: PATH }),
    ]);

    expect(order).toEqual([1, 2, 3]);
    expect(delays).toEqual([100, 100]);
  });
});

describe('defaults', () => {
  it('waits and reads the clock for real when neither is injected', async () => {
    server.use(onGet(URL, () => jsonBody({ ok: true })));
    // No token store either: the token client provides an in-memory one.
    const api = new DigiKeyClient({
      clientId: 'id-abc',
      clientSecret: 'secret-xyz',
      locale: { site: 'AU', language: 'en', currency: 'AUD' },
      minIntervalMs: 20,
    });

    const started = Date.now();
    await api.request(Schema, { method: 'GET', path: PATH });
    await api.request(Schema, { method: 'GET', path: PATH });

    expect(Date.now() - started).toBeGreaterThanOrEqual(19);
    expect(api.rateLimit.observedAt).toBeDefined();
  });

  it('uses an injected fetch for both the token and the API', async () => {
    server.use(onGet(URL, () => jsonBody({ ok: true })));
    const seen: string[] = [];
    const api = client({
      fetch: (url, init) => {
        seen.push(url);
        return globalThis.fetch(url, init);
      },
    });

    await api.request(Schema, { method: 'GET', path: PATH });

    expect(seen).toEqual([TOKEN_URL, URL]);
  });
});

describe('failures', () => {
  it('refreshes the token once on a 401 and retries', async () => {
    server.use(
      onGet(URL, (request) => {
        apiCalls += 1;
        return request.headers.get('authorization') === 'Bearer tok-1'
          ? statusBody(401)
          : jsonBody({ ok: true });
      }),
    );

    await expect(client().request(Schema, { method: 'GET', path: PATH })).resolves.toEqual({
      ok: true,
    });
    expect(tokenCalls).toBe(2);
    expect(apiCalls).toBe(2);
  });

  it('surfaces a 401 that survives the refresh', async () => {
    server.use(
      onGet(URL, () => {
        apiCalls += 1;
        return statusBody(401);
      }),
    );

    await expect(client().request(Schema, { method: 'GET', path: PATH })).rejects.toMatchObject({
      code: 'DIGIKEY_REQUEST_FAILED',
      details: { status: 401 },
    });
    expect(apiCalls).toBe(2);
  });

  it('reports a part Digi-Key does not list', async () => {
    server.use(onGet(URL, () => statusBody(404)));

    await expect(client().request(Schema, { method: 'GET', path: PATH })).rejects.toMatchObject({
      code: 'DIGIKEY_NOT_FOUND',
      details: { status: 404 },
    });
  });

  it.each([429, 500, 502, 503, 504, 408])('retries status %d and succeeds', async (status) => {
    server.use(
      onGet(URL, () => {
        apiCalls += 1;
        return apiCalls === 1 ? statusBody(status) : jsonBody({ ok: true });
      }),
    );

    await expect(client().request(Schema, { method: 'GET', path: PATH })).resolves.toEqual({
      ok: true,
    });
    expect(apiCalls).toBe(2);
  });

  it('waits the interval the API asks for', async () => {
    server.use(
      onGet(URL, () => {
        apiCalls += 1;
        return apiCalls === 1 ? statusBody(429, { 'retry-after': '7' }) : jsonBody({ ok: true });
      }),
    );

    await client({ minIntervalMs: 0 }).request(Schema, { method: 'GET', path: PATH });

    expect(delays).toContain(7000);
  });

  it('reports exhausted retries on a rate limit, with the quota', async () => {
    server.use(
      onGet(URL, () => {
        apiCalls += 1;
        return statusBody(429, { 'retry-after': '3', 'x-ratelimit-remaining': '0' });
      }),
    );

    await expect(
      client({ maxAttempts: 2 }).request(Schema, { method: 'GET', path: PATH }),
    ).rejects.toMatchObject({
      code: 'DIGIKEY_RATE_LIMITED',
      details: { status: 429, attempts: 2, retryAfterSeconds: 3, remaining: 0 },
    });
    expect(apiCalls).toBe(2);
  });

  it('backs off exponentially when the API gives no interval', async () => {
    server.use(
      onGet(URL, () => {
        apiCalls += 1;
        return statusBody(503);
      }),
    );

    await expect(
      client({ minIntervalMs: 0, maxAttempts: 3 }).request(Schema, { method: 'GET', path: PATH }),
    ).rejects.toMatchObject({
      code: 'DIGIKEY_REQUEST_FAILED',
    });
    expect(delays).toEqual([500, 1000]);
  });

  it('retries a transport failure and reports it once exhausted', async () => {
    // A dropped connection, not a 5xx: msw turns a thrown handler into a 500,
    // which exercises a different path.
    server.use(
      onGet(URL, () => {
        apiCalls += 1;
        return networkError();
      }),
    );

    await expect(
      client({ minIntervalMs: 0, maxAttempts: 2 }).request(Schema, { method: 'GET', path: PATH }),
    ).rejects.toMatchObject({
      code: 'DIGIKEY_REQUEST_FAILED',
      details: { attempts: 2 },
    });
    expect(apiCalls).toBe(2);
  });

  it('retries a transport failure and then succeeds', async () => {
    server.use(
      onGet(URL, () => {
        apiCalls += 1;
        return apiCalls === 1 ? networkError() : jsonBody({ ok: true });
      }),
    );

    await expect(
      client({ minIntervalMs: 0 }).request(Schema, { method: 'GET', path: PATH }),
    ).resolves.toEqual({
      ok: true,
    });
    expect(apiCalls).toBe(2);
  });

  it('ignores a quota header that is not a number', async () => {
    server.use(
      onGet(URL, () => jsonBody({ ok: true }, { headers: { 'x-ratelimit-remaining': 'unknown' } })),
    );
    const api = client();

    await api.request(Schema, { method: 'GET', path: PATH });

    expect(api.rateLimit.remaining).toBeUndefined();
  });

  it('reports a body that is not JSON', async () => {
    server.use(onGet(URL, () => textBody('<html>maintenance</html>')));

    await expect(client().request(Schema, { method: 'GET', path: PATH })).rejects.toMatchObject({
      code: 'DIGIKEY_RESPONSE_INVALID',
    });
  });

  it('reports a body that does not match the schema, naming the field', async () => {
    server.use(onGet(URL, () => jsonBody({ ok: 'yes' })));

    await expect(client().request(Schema, { method: 'GET', path: PATH })).rejects.toMatchObject({
      code: 'DIGIKEY_RESPONSE_INVALID',
      details: { issues: [expect.stringContaining('ok:') as string] },
    });
  });

  it('keeps serving later calls after one fails', async () => {
    server.use(
      onGet(URL, () => {
        apiCalls += 1;
        return apiCalls === 1 ? statusBody(404) : jsonBody({ ok: true });
      }),
    );
    const api = client();

    await expect(api.request(Schema, { method: 'GET', path: PATH })).rejects.toMatchObject({
      code: 'DIGIKEY_NOT_FOUND',
    });
    await expect(api.request(Schema, { method: 'GET', path: PATH })).resolves.toEqual({ ok: true });
  });
});
