import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { jsonBody, networkError, onPost, statusBody, textBody } from '../../../test/helpers/msw.js';
import {
  MOUSER_HOST,
  MouserClient,
  SEARCH_BASE,
  assertNoApiErrors,
  type MouserClientOptions,
} from './client.js';

const server = setupServer();
const PATH = `${SEARCH_BASE}/partnumber`;
const URL = `${MOUSER_HOST}${PATH}`;
const Schema = z.looseObject({ ok: z.boolean() });
const T0 = Date.parse('2026-09-10T10:00:00Z');

let now: number;
let delays: number[];
let calls: number;

function client(overrides: Partial<MouserClientOptions> = {}): MouserClient {
  return new MouserClient({
    apiKey: 'key-123',
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
  calls = 0;
});

describe('credentials', () => {
  it('refuses to run without a key, and says which key is needed', async () => {
    await expect(
      client({ apiKey: undefined }).request(Schema, { path: PATH, body: {} }),
    ).rejects.toMatchObject({ code: 'MOUSER_KEY_MISSING' });

    try {
      await client({ apiKey: undefined }).request(Schema, { path: PATH, body: {} });
    } catch (error) {
      expect((error as Error).message).toContain('separate registration');
    }
  });

  it('sends the key as a query parameter, not a header', async () => {
    let seen: string | undefined;
    let authorization: string | null = null;
    server.use(
      onPost(URL, (request) => {
        seen = request.url;
        authorization = request.headers.get('authorization');
        return jsonBody({ ok: true });
      }),
    );

    await client().request(Schema, { path: PATH, body: {} });

    expect(seen).toContain('apiKey=key-123');
    expect(authorization).toBeNull();
  });

  it('escapes a key that contains URL characters', async () => {
    let seen: string | undefined;
    server.use(
      onPost(URL, (request) => {
        seen = request.url;
        return jsonBody({ ok: true });
      }),
    );

    await client({ apiKey: 'a b&c' }).request(Schema, { path: PATH, body: {} });

    expect(seen).toContain('apiKey=a%20b%26c');
  });

  it('keeps the key out of error messages', async () => {
    server.use(onPost(URL, () => statusBody(500)));

    try {
      await client({ maxAttempts: 1 }).request(Schema, { path: PATH, body: {} });
    } catch (error) {
      expect((error as Error).message).not.toContain('key-123');
      expect(JSON.stringify((error as { details: unknown }).details)).not.toContain('key-123');
    }
  });
});

describe('requests', () => {
  it('posts the body as JSON', async () => {
    let body: unknown;
    server.use(
      onPost(URL, async (request) => {
        body = await request.json();
        return jsonBody({ ok: true });
      }),
    );

    await client().request(Schema, {
      path: PATH,
      body: { SearchByPartRequest: { mouserPartNumber: 'X' } },
    });

    expect(body).toEqual({ SearchByPartRequest: { mouserPartNumber: 'X' } });
  });

  it('uses the documented host unless one is given', () => {
    expect(client().host).toBe('https://api.mouser.com');
    expect(client({ host: 'https://example.test' }).host).toBe('https://example.test');
  });

  it('leaves a minimum gap between calls and serialises them', async () => {
    const order: number[] = [];
    server.use(
      onPost(URL, () => {
        calls += 1;
        order.push(calls);
        return jsonBody({ ok: true });
      }),
    );
    const api = client({ minIntervalMs: 100 });

    await Promise.all([
      api.request(Schema, { path: PATH, body: {} }),
      api.request(Schema, { path: PATH, body: {} }),
    ]);

    expect(order).toEqual([1, 2]);
    expect(delays).toEqual([100]);
  });

  it('does not wait when enough time has passed', async () => {
    server.use(onPost(URL, () => jsonBody({ ok: true })));
    const api = client({ minIntervalMs: 100 });

    await api.request(Schema, { path: PATH, body: {} });
    now += 300;
    await api.request(Schema, { path: PATH, body: {} });

    expect(delays).toEqual([]);
  });
});

describe('failures', () => {
  it.each([429, 500, 503, 408])('retries status %d and succeeds', async (status) => {
    server.use(
      onPost(URL, () => {
        calls += 1;
        return calls === 1 ? statusBody(status) : jsonBody({ ok: true });
      }),
    );

    await expect(client().request(Schema, { path: PATH, body: {} })).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('waits the interval the API asks for', async () => {
    server.use(
      onPost(URL, () => {
        calls += 1;
        return calls === 1 ? statusBody(429, { 'retry-after': '5' }) : jsonBody({ ok: true });
      }),
    );

    await client({ minIntervalMs: 0 }).request(Schema, { path: PATH, body: {} });

    expect(delays).toContain(5000);
  });

  it('reports an exhausted rate limit distinctly', async () => {
    server.use(onPost(URL, () => statusBody(429)));

    await expect(
      client({ maxAttempts: 2, minIntervalMs: 0 }).request(Schema, { path: PATH, body: {} }),
    ).rejects.toMatchObject({
      code: 'MOUSER_RATE_LIMITED',
      details: { status: 429, attempts: 2 },
    });
  });

  it('backs off exponentially without a stated interval', async () => {
    server.use(onPost(URL, () => statusBody(503)));

    await expect(
      client({ maxAttempts: 3, minIntervalMs: 0 }).request(Schema, { path: PATH, body: {} }),
    ).rejects.toMatchObject({
      code: 'MOUSER_REQUEST_FAILED',
    });
    expect(delays).toEqual([500, 1000]);
  });

  it('reports a status it will not retry', async () => {
    server.use(onPost(URL, () => statusBody(403)));

    await expect(client().request(Schema, { path: PATH, body: {} })).rejects.toMatchObject({
      code: 'MOUSER_REQUEST_FAILED',
      details: { status: 403 },
    });
  });

  it('retries a transport failure and reports it once exhausted', async () => {
    server.use(
      onPost(URL, () => {
        calls += 1;
        return networkError();
      }),
    );

    await expect(
      client({ maxAttempts: 2, minIntervalMs: 0 }).request(Schema, { path: PATH, body: {} }),
    ).rejects.toMatchObject({
      code: 'MOUSER_REQUEST_FAILED',
      details: { attempts: 2 },
    });
    expect(calls).toBe(2);
  });

  it('retries a transport failure and then succeeds', async () => {
    server.use(
      onPost(URL, () => {
        calls += 1;
        return calls === 1 ? networkError() : jsonBody({ ok: true });
      }),
    );

    await expect(
      client({ minIntervalMs: 0 }).request(Schema, { path: PATH, body: {} }),
    ).resolves.toEqual({ ok: true });
  });

  it('reports a body that is not JSON, and one that does not match', async () => {
    server.use(onPost(URL, () => textBody('<html>down</html>')));
    await expect(client().request(Schema, { path: PATH, body: {} })).rejects.toMatchObject({
      code: 'MOUSER_RESPONSE_INVALID',
    });

    server.use(onPost(URL, () => jsonBody({ ok: 'yes' })));
    await expect(client().request(Schema, { path: PATH, body: {} })).rejects.toMatchObject({
      code: 'MOUSER_RESPONSE_INVALID',
      details: { issues: [expect.stringContaining('ok:') as string] },
    });
  });

  it('uses real timing when neither clock nor sleep is injected', async () => {
    server.use(onPost(URL, () => jsonBody({ ok: true })));
    const api = new MouserClient({ apiKey: 'key-123', minIntervalMs: 20 });

    const started = Date.now();
    await api.request(Schema, { path: PATH, body: {} });
    await api.request(Schema, { path: PATH, body: {} });

    expect(Date.now() - started).toBeGreaterThanOrEqual(19);
  });
});

describe('assertNoApiErrors', () => {
  it('accepts an empty list', () => {
    expect(() => {
      assertNoApiErrors([], PATH);
    }).not.toThrow();
  });

  it('rejects a body carrying errors, since Mouser sends them with HTTP 200', () => {
    expect(() => {
      assertNoApiErrors(
        [{ Code: 'Invalid', Message: 'Invalid unique identifier.', PropertyName: 'API Key' }],
        PATH,
      );
    }).toThrow(/API Key: Invalid unique identifier/);

    try {
      assertNoApiErrors([{ Code: 'Invalid', Message: 'bad' }], PATH);
    } catch (error) {
      expect((error as { code: string }).code).toBe('MOUSER_API_ERROR');
      expect((error as { details: { errors: unknown } }).details.errors).toEqual([
        { code: 'Invalid', message: 'bad' },
      ]);
    }
  });

  it('describes an error that carries only a code, or only a message', () => {
    expect(() => {
      assertNoApiErrors([{ Code: 'TooManyRequests' }], PATH);
    }).toThrow(/TooManyRequests/);

    try {
      assertNoApiErrors([{ Message: 'something went wrong' }], PATH);
    } catch (error) {
      expect((error as { details: { errors: unknown } }).details.errors).toEqual([
        { message: 'something went wrong' },
      ]);
    }
  });
});
