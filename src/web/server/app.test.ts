import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { capturedLogger, recordedRequest, recordedResponse } from '../../../test/helpers/web.js';
import { createRedactor } from '../../log/redact.js';
import { createApp, type RequestContext, type RouteEntry } from './app.js';
import { WebError } from './errors.js';
import { createResponder } from './respond.js';
import { Router } from './router.js';
import { createSecurity, originsFor, SESSION_COOKIE, TOKEN_HEADER } from './security.js';

const TOKEN = 'tokentokentokentoken';
const redact = createRedactor({ secrets: ['super-secret-key'] });

function build(routes: (router: Router<RouteEntry>) => void) {
  const router = new Router<RouteEntry>();
  routes(router);
  const log = capturedLogger();
  let now = 1_000;
  const app = createApp({
    router,
    responder: createResponder(redact),
    security: createSecurity({ token: TOKEN, origins: originsFor('127.0.0.1', 5174) }),
    logger: log.logger,
    redact,
    maxBodyBytes: 64,
    clock: () => (now += 5),
  });
  return { app, log };
}

const open = (handler: RouteEntry['handler']): RouteEntry => ({ access: 'open', handler });
const read = (handler: RouteEntry['handler']): RouteEntry => ({ access: 'read', handler });
const write = (handler: RouteEntry['handler']): RouteEntry => ({ access: 'write', handler });

const hello = (context: RequestContext): void => {
  context.respond.json(context.response, context.facts, { hello: context.params.name ?? 'all' });
};

const bearer = { authorization: `Bearer ${TOKEN}` };

describe('routing and access', () => {
  it('answers an open route with no credential at all', async () => {
    const { app, log } = build((router) => router.get('/hello/:name', open(hello)));
    const response = recordedResponse();
    await app(recordedRequest({ url: '/hello/world' }), response);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual({ hello: 'world' });
    expect(log.of('request')[0]).toMatchObject({
      method: 'GET',
      path: '/hello/world',
      status: 200,
      ms: 5,
    });
  });

  it('refuses a read route without a token and allows it with one', async () => {
    const { app } = build((router) => router.get('/api/parts', read(hello)));
    const refused = recordedResponse();
    await app(recordedRequest({ url: '/api/parts' }), refused);
    expect(refused.statusCode).toBe(401);
    const allowed = recordedResponse();
    await app(recordedRequest({ url: '/api/parts', headers: bearer }), allowed);
    expect(allowed.statusCode).toBe(200);
  });

  it('applies the stricter checks to a write route', async () => {
    const { app } = build((router) => router.post('/api/parts', write(hello)));
    const cookieOnly = recordedResponse();
    await app(
      recordedRequest({
        method: 'POST',
        url: '/api/parts',
        headers: { cookie: `${SESSION_COOKIE}=${TOKEN}` },
      }),
      cookieOnly,
    );
    expect(cookieOnly.statusCode).toBe(403);
    const withHeader = recordedResponse();
    await app(
      recordedRequest({
        method: 'POST',
        url: '/api/parts',
        headers: { cookie: `${SESSION_COOKIE}=${TOKEN}`, [TOKEN_HEADER]: TOKEN },
      }),
      withHeader,
    );
    expect(withHeader.statusCode).toBe(200);
  });

  it('says what is served nowhere', async () => {
    const { app } = build((router) => router.get('/hello/:name', open(hello)));
    const response = recordedResponse();
    await app(recordedRequest({ url: '/nothing' }), response);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'WEB_NOT_FOUND' } });
  });

  it('reports the methods a path allows', async () => {
    const { app } = build((router) => router.get('/hello/:name', open(hello)));
    const response = recordedResponse();
    await app(recordedRequest({ method: 'DELETE', url: '/hello/world' }), response);
    expect(response.statusCode).toBe(405);
    expect(response.json()).toMatchObject({
      error: { code: 'WEB_METHOD_NOT_ALLOWED', details: { allow: ['GET', 'HEAD'] } },
    });
  });

  it('answers OPTIONS with the allowed methods and no body', async () => {
    const { app } = build((router) => router.get('/hello/:name', open(hello)));
    const response = recordedResponse();
    await app(recordedRequest({ method: 'OPTIONS', url: '/hello/world' }), response);
    expect(response.statusCode).toBe(204);
    expect(response.headers.Allow).toBe('GET, HEAD');
    expect(response.body).toBe('');
  });

  it('treats a request with no method or URL as GET /', async () => {
    const { app } = build((router) => router.get('/', open(hello)));
    const response = recordedResponse();
    await app(
      {
        headers: {},
        async *[Symbol.asyncIterator]() {
          // a request with no body at all
        },
      },
      response,
    );
    expect(response.statusCode).toBe(200);
  });

  it('rejects a URL that cannot be parsed', async () => {
    const { app } = build((router) => router.get('/', open(hello)));
    const response = recordedResponse();
    await app(recordedRequest({ url: 'http://[' }), response);
    expect(response.json()).toMatchObject({ error: { code: 'WEB_BAD_URL', status: 400 } });
  });

  it('passes a conditional request through to the responder', async () => {
    const { app } = build((router) => router.get('/hello/:name', open(hello)));
    const first = recordedResponse();
    await app(recordedRequest({ url: '/hello/world' }), first);
    const etag = String(first.headers.ETag ?? '');
    const second = recordedResponse();
    await app(
      recordedRequest({ url: '/hello/world', headers: { 'if-none-match': [etag, '"other"'] } }),
      second,
    );
    expect(second.statusCode).toBe(304);
  });
});

describe('defaults', () => {
  it('uses the wall clock and the 4 MiB body limit when it is given neither', async () => {
    const router = new Router<RouteEntry>();
    router.get('/hello/:name', open(hello));
    const log = capturedLogger();
    const app = createApp({
      router,
      responder: createResponder(redact),
      security: createSecurity({ token: TOKEN, origins: originsFor('127.0.0.1', 5174) }),
      logger: log.logger,
      redact,
    });
    const response = recordedResponse();
    await app(recordedRequest({ url: '/hello/world' }), response);
    expect(response.statusCode).toBe(200);
    expect(log.of('request')[0]?.ms).toBeTypeOf('number');
  });
});

describe('request bodies', () => {
  const Body = z.strictObject({ mpn: z.string() });
  const echo = (context: RequestContext): Promise<void> =>
    context.json(Body, 'Body').then((body) => {
      context.respond.json(context.response, context.facts, body);
    });

  function post(body: string | readonly string[], headers = bearer) {
    return recordedRequest({ method: 'POST', url: '/api/echo', headers, body });
  }

  it('reads and validates JSON', async () => {
    const { app } = build((router) => router.post('/api/echo', read(echo)));
    const response = recordedResponse();
    await app(post(['{"mpn":', '"TPS54331DR"}']), response);
    expect(response.json()).toStrictEqual({ mpn: 'TPS54331DR' });
  });

  it('rejects a body that is not JSON, and one that is not the right JSON', async () => {
    const { app } = build((router) => router.post('/api/echo', read(echo)));
    const broken = recordedResponse();
    await app(post('{nope'), broken);
    expect(broken.json()).toMatchObject({ error: { code: 'WEB_BAD_JSON', status: 400 } });
    const wrong = recordedResponse();
    await app(post('{"mpn":7}'), wrong);
    expect(wrong.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED', status: 400 } });
  });

  it('rejects an empty body where one is required', async () => {
    const { app } = build((router) => router.post('/api/echo', read(echo)));
    const response = recordedResponse();
    await app(post('  '), response);
    expect(response.json()).toMatchObject({ error: { code: 'WEB_BODY_REQUIRED' } });
  });

  it('refuses a body larger than the limit', async () => {
    const { app } = build((router) => router.post('/api/echo', read(echo)));
    const response = recordedResponse();
    await app(post(`{"mpn":"${'x'.repeat(200)}"}`), response);
    expect(response.json()).toMatchObject({
      error: { code: 'WEB_BODY_TOO_LARGE', details: { limit: 64 } },
    });
  });

  it('hands raw bytes to a handler that wants them', async () => {
    const { app } = build((router) =>
      router.post(
        '/api/raw',
        read(async (context) => {
          const bytes = await context.bytes();
          context.respond.json(context.response, context.facts, { bytes: bytes.byteLength });
        }),
      ),
    );
    const response = recordedResponse();
    await app(
      recordedRequest({ method: 'POST', url: '/api/raw', headers: bearer, body: 'abcd' }),
      response,
    );
    expect(response.json()).toStrictEqual({ bytes: 4 });
  });
});

describe('failures and streams', () => {
  it('reports a handler that answers nothing', async () => {
    const { app, log } = build((router) =>
      router.get(
        '/quiet',
        open(() => undefined),
      ),
    );
    const response = recordedResponse();
    await app(recordedRequest({ url: '/quiet' }), response);
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: { code: 'WEB_NO_RESPONSE' } });
    expect(log.of('request failed')).toHaveLength(1);
  });

  it('leaves a stream open and does not complain about it', async () => {
    const { app } = build((router) =>
      router.get(
        '/events',
        open((context) => {
          context.stream({ heartbeatMs: 0 }).send('ready', { ok: true });
        }),
      ),
    );
    const response = recordedResponse();
    await app(recordedRequest({ url: '/events' }), response);
    expect(response.writableEnded).toBe(false);
    expect(response.chunks.at(-1)).toContain('event: ready');
  });

  it('redacts what a failed handler says', async () => {
    const { app } = build((router) =>
      router.get(
        '/leaky',
        open(() => {
          throw new WebError(400, 'WEB_LEAK', 'refused super-secret-key', {
            details: { key: 'super-secret-key' },
          });
        }),
      ),
    );
    const response = recordedResponse();
    await app(recordedRequest({ url: '/leaky' }), response);
    expect(response.body).not.toContain('super-secret-key');
    expect(response.json()).toMatchObject({ error: { message: 'refused [redacted]' } });
  });

  it('logs but does not answer twice when a handler fails after answering', async () => {
    const { app, log } = build((router) =>
      router.get(
        '/late',
        open((context) => {
          context.respond.json(context.response, context.facts, { done: true });
          throw new Error('after the fact');
        }),
      ),
    );
    const response = recordedResponse();
    await app(recordedRequest({ url: '/late' }), response);
    expect(response.json()).toStrictEqual({ done: true });
    expect(log.of('request failed')).toHaveLength(1);
    expect(log.of('request')[0]).toMatchObject({ status: 500 });
  });
});
