import type { z } from 'zod';

import { parseOrThrow } from '../../core/validation-error.js';
import type { Logger } from '../../log/logger.js';
import { WebError, failureFor } from './errors.js';
import type { HttpResponseLike, RequestFacts, Responder } from './respond.js';
import type { RouteParams, Router } from './router.js';
import type { AuthResult, Security } from './security.js';
import { openSse, type SseOptions, type SseSink, type SseStream } from './sse.js';

/**
 * What a route needs before it runs.
 *
 * `open` is for the application shell and its assets, which a browser must be
 * able to fetch before it holds anything. `read` is every query. `write` is
 * every mutation and every run launch, and carries the extra checks in
 * `security.requireWrite` (D67).
 */
export type Access = 'open' | 'read' | 'write';

export type IncomingHeaders = Readonly<Record<string, string | string[] | undefined>>;

/** The part of `IncomingMessage` the app uses, so a request can be faked. */
export interface HttpRequestLike extends AsyncIterable<Uint8Array> {
  readonly method?: string | undefined;
  readonly url?: string | undefined;
  readonly headers: IncomingHeaders;
}

export interface ResponseSink extends HttpResponseLike, SseSink {}

export interface RequestContext {
  readonly method: string;
  readonly url: URL;
  readonly params: RouteParams;
  readonly query: URLSearchParams;
  readonly headers: IncomingHeaders;
  readonly facts: RequestFacts;
  readonly response: ResponseSink;
  readonly respond: Responder;
  readonly security: Security;
  readonly auth: AuthResult;
  readonly log: Logger;
  /** Reads the request body as JSON and validates it. Never coerces. */
  json<T extends z.ZodType>(schema: T, subject: string): Promise<z.output<T>>;
  /** Reads the request body as bytes, subject to the size limit. */
  bytes(): Promise<Uint8Array>;
  /** Takes the response over as an event stream. The app stops managing it. */
  stream(options?: SseOptions): SseStream;
}

export interface RouteEntry {
  readonly access: Access;
  readonly handler: (context: RequestContext) => Promise<void> | void;
}

export interface AppOptions {
  readonly router: Router<RouteEntry>;
  readonly responder: Responder;
  readonly security: Security;
  readonly logger: Logger;
  /** Applied to every error body, as the responder applies it to every result. */
  readonly redact: (value: unknown) => unknown;
  /** Largest request body accepted, in bytes. Default 4 MiB. */
  readonly maxBodyBytes?: number;
  readonly clock?: () => number;
}

export const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;

async function readBytes(request: HttpRequestLike, limit: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.byteLength;
    if (total > limit) {
      throw new WebError(413, 'WEB_BODY_TOO_LARGE', `request body exceeds ${String(limit)} bytes`, {
        details: { limit },
      });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

function parseJsonBody(bytes: Uint8Array): unknown {
  const text = new TextDecoder().decode(bytes);
  if (text.trim() === '') {
    throw new WebError(400, 'WEB_BODY_REQUIRED', 'this request needs a JSON body');
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new WebError(400, 'WEB_BAD_JSON', 'request body is not valid JSON', { cause: error });
  }
}

function urlOf(request: HttpRequestLike): URL {
  try {
    return new URL(request.url ?? '/', 'http://server.invalid');
  } catch (error) {
    throw new WebError(400, 'WEB_BAD_URL', `request URL cannot be parsed: ${String(request.url)}`, {
      cause: error,
    });
  }
}

function headerOf(headers: IncomingHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Builds the request handler.
 *
 * Three things happen here and nowhere else: access is decided before a
 * handler sees the request, every error becomes a status through one mapping,
 * and every request is logged with its outcome. A handler that returns
 * without answering is a defect, and is reported as one rather than left to
 * hang the browser.
 */
export function createApp(
  options: AppOptions,
): (request: HttpRequestLike, response: ResponseSink) => Promise<void> {
  const { router, responder, security, logger, redact } = options;
  const limit = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const clock = options.clock ?? (() => Date.now());

  return async function handle(request: HttpRequestLike, response: ResponseSink): Promise<void> {
    const started = clock();
    const method = request.method ?? 'GET';
    let status = 500;
    let path = request.url ?? '';
    let via: AuthResult['via'] = 'none';
    try {
      const url = urlOf(request);
      path = url.pathname;
      const facts: RequestFacts = {
        method,
        ifNoneMatch: headerOf(request.headers, 'if-none-match'),
      };
      const lookup = router.find(method, url.pathname);
      if (lookup.kind === 'not_found') {
        throw new WebError(404, 'WEB_NOT_FOUND', `nothing is served at ${url.pathname}`);
      }
      if (lookup.kind === 'method_not_allowed') {
        const allow = lookup.allow.join(', ');
        if (method === 'OPTIONS') {
          response.setHeader('Allow', allow);
          response.statusCode = 204;
          response.end();
          status = 204;
          return;
        }
        throw new WebError(405, 'WEB_METHOD_NOT_ALLOWED', `${method} is not allowed here`, {
          details: { allow: lookup.allow },
        });
      }

      const authRequest = { method, headers: request.headers, query: url.searchParams };
      let auth: AuthResult = { authenticated: false, via: 'none' };
      if (lookup.handler.access === 'read') {
        auth = security.requireRead(authRequest);
      } else if (lookup.handler.access === 'write') {
        security.requireWrite(authRequest);
        auth = security.authenticate(authRequest);
      } else {
        auth = security.authenticate(authRequest);
      }
      via = auth.via;

      // A holder rather than a plain boolean: the handler sets it through the
      // closure, which narrowing on a local would not see.
      const streamed = { value: false };
      const context: RequestContext = {
        method,
        url,
        params: lookup.params,
        query: url.searchParams,
        headers: request.headers,
        facts,
        response,
        respond: responder,
        security,
        auth,
        log: logger,
        async json(schema, subject) {
          return parseOrThrow(schema, parseJsonBody(await readBytes(request, limit)), subject);
        },
        async bytes() {
          return readBytes(request, limit);
        },
        stream(sseOptions = {}) {
          streamed.value = true;
          return openSse(response, sseOptions);
        },
      };

      await lookup.handler.handler(context);
      if (!response.writableEnded && !streamed.value) {
        throw new WebError(
          500,
          'WEB_NO_RESPONSE',
          `the handler for ${lookup.pattern} returned without answering`,
        );
      }
      status = response.statusCode;
    } catch (error) {
      const failure = failureFor(error, redact);
      status = failure.status;
      if (failure.internal) {
        logger.error('request failed', { method, path, status, error });
      }
      if (!response.writableEnded) {
        responder.failure(response, { method }, failure);
      }
    } finally {
      logger.info('request', { method, path, status, ms: clock() - started, auth: via });
    }
  };
}
