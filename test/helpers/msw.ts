/**
 * The single boundary where Mock Service Worker's types are touched.
 *
 * msw's request-handler types do not resolve under type-aware linting, even
 * though `tsc` accepts them, so every unsafe call and return lives here and
 * this file alone carries the rule exception in `eslint.config.js`. Tests use
 * the plain `Request`/`Response` signatures below and stay fully checked.
 */
import { HttpResponse, http, type RequestHandler } from 'msw';

export type Responder = (request: Request) => Response | Promise<Response>;

/** Handles GET requests for `url`, which may contain msw path wildcards. */
export function onGet(url: string, respond: Responder): RequestHandler {
  return http.get(url, ({ request }) => respond(request));
}

function toArrayBuffer(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** A body of raw bytes, `application/pdf` unless overridden. */
export function bytesBody(bytes: Buffer, headers: Record<string, string> = {}): Response {
  return HttpResponse.arrayBuffer(toArrayBuffer(bytes), {
    headers: { 'content-type': 'application/pdf', ...headers },
  });
}

/** A chunked body, which carries no content-length. */
export function streamedBody(bytes: Buffer, headers: Record<string, string> = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
  return new HttpResponse(stream, { headers: { 'content-type': 'application/pdf', ...headers } });
}

/** A body of raw bytes with no content-type at all. */
export function untypedBody(bytes: Buffer): Response {
  return HttpResponse.arrayBuffer(toArrayBuffer(bytes));
}

export function htmlBody(html: string): Response {
  return HttpResponse.html(html);
}

/** A status-only response, for redirects and failures. */
export function statusBody(status: number, headers: Record<string, string> = {}): Response {
  return new HttpResponse(null, { status, headers });
}

/** A transport-level failure, as a dropped connection would appear. */
export function networkError(): Response {
  return HttpResponse.error();
}
