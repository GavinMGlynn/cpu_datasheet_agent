import { createHash } from 'node:crypto';

import type { Failure } from './errors.js';

/**
 * The part of `ServerResponse` this module uses.
 *
 * Declared structurally rather than imported so a response can be faked in a
 * test without a socket. `node:http`'s `ServerResponse` satisfies it.
 */
export interface HttpResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(chunk?: Uint8Array | string): unknown;
  readonly writableEnded: boolean;
}

/** What a responder needs to know about the request it is answering. */
export interface RequestFacts {
  readonly method: string;
  /** The `If-None-Match` header, when the client sent one. */
  readonly ifNoneMatch?: string | undefined;
}

/**
 * How long a response may be reused.
 *
 * `live` is for anything the store or the ledger can change under us, which
 * is most of the API: the site is a window onto a database being written to
 * while it is open. `derived` is for bytes that are a pure function of
 * content that never changes — a page rendered from a datasheet whose hash is
 * in the URL. `asset` is for build output whose file name carries its hash.
 */
export type CachePolicy = 'live' | 'derived' | 'asset';

const CACHE_CONTROL: Readonly<Record<CachePolicy, string>> = Object.freeze({
  live: 'no-cache',
  derived: 'public, max-age=86400',
  asset: 'public, max-age=31536000, immutable',
});

export interface SendOptions {
  readonly status?: number;
  readonly policy?: CachePolicy;
  readonly headers?: Readonly<Record<string, string>>;
  /** Skip the entity tag. Streams and very large bodies do not want one. */
  readonly etag?: boolean;
}

export function etagOf(body: Uint8Array): string {
  return `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"`;
}

function matches(header: string | undefined, etag: string): boolean {
  if (header === undefined) {
    return false;
  }
  return header
    .split(',')
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === etag || candidate === '*');
}

function writeHeaders(
  response: HttpResponseLike,
  headers: Readonly<Record<string, string>> | undefined,
): void {
  for (const [name, value] of Object.entries(headers ?? {})) {
    response.setHeader(name, value);
  }
}

/**
 * Sends bytes, honouring conditional requests and HEAD.
 *
 * A HEAD gets every header the GET would, including `Content-Length`, and no
 * body — the length is the answer to most HEAD requests, so computing it and
 * then not sending it is the whole point.
 */
export function sendBytes(
  response: HttpResponseLike,
  request: RequestFacts,
  body: Uint8Array,
  contentType: string,
  options: SendOptions = {},
): void {
  const policy = options.policy ?? 'live';
  writeHeaders(response, options.headers);
  response.setHeader('Cache-Control', CACHE_CONTROL[policy]);
  response.setHeader('Content-Type', contentType);
  if (options.etag !== false) {
    const etag = etagOf(body);
    response.setHeader('ETag', etag);
    if (matches(request.ifNoneMatch, etag)) {
      response.statusCode = 304;
      response.end();
      return;
    }
  }
  response.setHeader('Content-Length', String(body.byteLength));
  response.statusCode = options.status ?? 200;
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  response.end(body);
}

const encoder = new TextEncoder();

export function sendText(
  response: HttpResponseLike,
  request: RequestFacts,
  text: string,
  contentType = 'text/plain; charset=utf-8',
  options: SendOptions = {},
): void {
  sendBytes(response, request, encoder.encode(text), contentType, options);
}

/** A response with no body at all: 204, or 304 from a caller that made its own tag. */
export function sendEmpty(response: HttpResponseLike, status: number, headers = {}): void {
  writeHeaders(response, headers);
  response.statusCode = status;
  response.end();
}

export interface Responder {
  json(
    response: HttpResponseLike,
    request: RequestFacts,
    value: unknown,
    options?: SendOptions,
  ): void;
  bytes(
    response: HttpResponseLike,
    request: RequestFacts,
    body: Uint8Array,
    contentType: string,
    options?: SendOptions,
  ): void;
  text(
    response: HttpResponseLike,
    request: RequestFacts,
    text: string,
    contentType?: string,
    options?: SendOptions,
  ): void;
  failure(response: HttpResponseLike, request: RequestFacts, failure: Failure): void;
}

/**
 * Builds the responders bound to one redactor.
 *
 * Every JSON body the server sends goes through here, so there is exactly one
 * place where a credential could escape into a response and exactly one place
 * that stops it (D67). A handler that serialises its own body is a bug this
 * shape is meant to make obvious.
 */
export function createResponder(redact: (value: unknown) => unknown): Responder {
  return {
    json(response, request, value, options = {}) {
      const text = JSON.stringify(redact(value) ?? null);
      sendText(response, request, text, 'application/json; charset=utf-8', options);
    },
    bytes(response, request, body, contentType, options = {}) {
      sendBytes(response, request, body, contentType, options);
    },
    text(response, request, text, contentType, options = {}) {
      sendText(response, request, text, contentType, options);
    },
    failure(response, request, failure) {
      const text = JSON.stringify(failure.body);
      sendText(response, request, text, 'application/json; charset=utf-8', {
        status: failure.status,
        policy: 'live',
        etag: false,
      });
    },
  };
}
