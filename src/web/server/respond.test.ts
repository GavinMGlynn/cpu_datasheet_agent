import { describe, expect, it } from 'vitest';

import { createRedactor } from '../../log/redact.js';
import type { Failure } from './errors.js';
import {
  createResponder,
  etagOf,
  sendBytes,
  sendEmpty,
  sendText,
  type HttpResponseLike,
} from './respond.js';

interface Recorded extends HttpResponseLike {
  readonly headers: Record<string, string>;
  body: string | undefined;
  writableEnded: boolean;
}

function fakeResponse(): Recorded {
  const headers: Record<string, string> = {};
  return {
    statusCode: 0,
    headers,
    body: undefined,
    writableEnded: false,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    end(chunk?: Uint8Array | string) {
      this.body = chunk === undefined ? undefined : new TextDecoder().decode(chunk as Uint8Array);
      this.writableEnded = true;
    },
  };
}

const get = { method: 'GET' };
const bytes = new TextEncoder().encode('{"mpn":"TPS54331DR"}');

describe('sendBytes', () => {
  it('sends the body with a tag, a length and the live cache policy', () => {
    const response = fakeResponse();
    sendBytes(response, get, bytes, 'application/json');
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('{"mpn":"TPS54331DR"}');
    expect(response.headers).toStrictEqual({
      'Cache-Control': 'no-cache',
      'Content-Type': 'application/json',
      'Content-Length': '20',
      ETag: etagOf(bytes),
    });
  });

  it('answers 304 when the client already has the bytes', () => {
    const response = fakeResponse();
    sendBytes(response, { method: 'GET', ifNoneMatch: etagOf(bytes) }, bytes, 'application/json');
    expect(response.statusCode).toBe(304);
    expect(response.body).toBeUndefined();
    expect(response.headers['Content-Length']).toBeUndefined();
  });

  it('accepts a list of tags and a wildcard', () => {
    const list = fakeResponse();
    sendBytes(list, { method: 'GET', ifNoneMatch: `"other", ${etagOf(bytes)}` }, bytes, 'text/x');
    expect(list.statusCode).toBe(304);
    const wildcard = fakeResponse();
    sendBytes(wildcard, { method: 'GET', ifNoneMatch: '*' }, bytes, 'text/x');
    expect(wildcard.statusCode).toBe(304);
  });

  it('sends the body when the tag does not match', () => {
    const response = fakeResponse();
    sendBytes(response, { method: 'GET', ifNoneMatch: '"stale"' }, bytes, 'text/x');
    expect(response.statusCode).toBe(200);
  });

  it('gives HEAD every header and no body', () => {
    const response = fakeResponse();
    sendBytes(response, { method: 'HEAD' }, bytes, 'application/json');
    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Length']).toBe('20');
    expect(response.body).toBeUndefined();
  });

  it('honours status, extra headers, and a policy of derived or asset', () => {
    const derived = fakeResponse();
    sendBytes(derived, get, bytes, 'image/png', {
      status: 201,
      policy: 'derived',
      headers: { 'X-Page': '7' },
    });
    expect(derived.statusCode).toBe(201);
    expect(derived.headers['Cache-Control']).toBe('public, max-age=86400');
    expect(derived.headers['X-Page']).toBe('7');
    const asset = fakeResponse();
    sendBytes(asset, get, bytes, 'text/javascript', { policy: 'asset' });
    expect(asset.headers['Cache-Control']).toBe('public, max-age=31536000, immutable');
  });

  it('omits the tag when asked to', () => {
    const response = fakeResponse();
    sendBytes(response, { method: 'GET', ifNoneMatch: etagOf(bytes) }, bytes, 'text/x', {
      etag: false,
    });
    expect(response.headers.ETag).toBeUndefined();
    expect(response.statusCode).toBe(200);
  });
});

describe('sendText and sendEmpty', () => {
  it('defaults to plain text', () => {
    const response = fakeResponse();
    sendText(response, get, 'hello');
    expect(response.headers['Content-Type']).toBe('text/plain; charset=utf-8');
    expect(response.body).toBe('hello');
  });

  it('sends a bodiless response, with headers when given', () => {
    const bare = fakeResponse();
    sendEmpty(bare, 204);
    expect(bare.statusCode).toBe(204);
    expect(bare.body).toBeUndefined();
    const withHeaders = fakeResponse();
    sendEmpty(withHeaders, 405, { Allow: 'GET, HEAD' });
    expect(withHeaders.headers.Allow).toBe('GET, HEAD');
  });
});

describe('createResponder', () => {
  const responder = createResponder(createRedactor({ secrets: ['super-secret-key'] }));

  it('redacts every JSON body it sends', () => {
    const response = fakeResponse();
    responder.json(response, get, { note: 'key is super-secret-key' });
    expect(response.body).toBe('{"note":"key is [redacted]"}');
    expect(response.headers['Content-Type']).toBe('application/json; charset=utf-8');
  });

  it('sends null for a value that is not JSON at all', () => {
    const response = fakeResponse();
    responder.json(response, get, undefined);
    expect(response.body).toBe('null');
  });

  it('passes bytes and text through', () => {
    const raw = fakeResponse();
    responder.bytes(raw, get, bytes, 'image/png', { policy: 'derived' });
    expect(raw.headers['Content-Type']).toBe('image/png');
    const markdown = fakeResponse();
    responder.text(markdown, get, '# summary', 'text/markdown; charset=utf-8');
    expect(markdown.headers['Content-Type']).toBe('text/markdown; charset=utf-8');
    const fallback = fakeResponse();
    responder.text(fallback, get, 'plain', undefined);
    expect(fallback.headers['Content-Type']).toBe('text/plain; charset=utf-8');
  });

  it('sends a failure with its status and no entity tag', () => {
    const failure: Failure = {
      status: 404,
      internal: false,
      body: { error: { code: 'DB_PART_NOT_FOUND', message: 'no such part', status: 404 } },
    };
    const response = fakeResponse();
    responder.failure(response, get, failure);
    expect(response.statusCode).toBe(404);
    expect(response.headers.ETag).toBeUndefined();
    expect(JSON.parse(response.body ?? '')).toStrictEqual(failure.body);
  });
});
