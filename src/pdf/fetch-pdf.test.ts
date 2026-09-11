import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Cache, FileCacheStore } from '../cache/index.js';
import {
  bytesBody,
  htmlBody,
  networkError,
  onGet,
  statusBody,
  streamedBody,
  untypedBody,
} from '../../test/helpers/msw.js';
import { buildPdf, simpleSpec } from '../../test/helpers/pdf-fixtures.js';
import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_PDF_BYTES,
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_USER_AGENT,
  PDF_MAGIC,
  fetchPdf,
  type PdfFetchError,
  type PdfFetcherDeps,
} from './fetch-pdf.js';

const URL_A = 'https://example.test/datasheets/a.pdf';
const server = setupServer();

let root: string;
let store: FileCacheStore;
let cache: Cache;
let delays: number[];
let deps: PdfFetcherDeps;
let pdfBytes: Buffer;
let requests: string[];

function servePdf(url = URL_A, bytes?: Buffer, headers?: Record<string, string>): void {
  server.use(
    onGet(url, (request) => {
      requests.push(request.url);
      return bytesBody(bytes ?? pdfBytes, headers);
    }),
  );
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterAll(() => {
  server.close();
});

beforeEach(async () => {
  server.resetHandlers();
  requests = [];
  root = await mkdtemp(path.join(tmpdir(), 'fetch-pdf-'));
  store = new FileCacheStore(path.join(root, 'cache'));
  cache = new Cache({ store });
  delays = [];
  const sleep = (ms: number): Promise<void> => {
    delays.push(ms);
    return Promise.resolve();
  };
  deps = { cache, store, sleep };
  pdfBytes = await buildPdf(simpleSpec('hello datasheet'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('fetchPdf', () => {
  it('downloads, caches, and returns the stored file', async () => {
    servePdf();

    const result = await fetchPdf(deps, URL_A);

    expect(result.url).toBe(URL_A);
    expect(result.hit).toBe(false);
    expect(result.size).toBe(pdfBytes.length);
    expect(result.sha256).toBe(createHash('sha256').update(pdfBytes).digest('hex'));
    expect(result.bytes.equals(pdfBytes)).toBe(true);
    expect((await readFile(result.localPath)).equals(pdfBytes)).toBe(true);
    expect(requests).toHaveLength(1);
  });

  it('serves a second call from the cache without a request', async () => {
    servePdf();
    const first = await fetchPdf(deps, URL_A);
    server.resetHandlers();

    const second = await fetchPdf(deps, URL_A);

    expect(second.hit).toBe(true);
    expect(second.localPath).toBe(first.localPath);
    expect(second.sha256).toBe(first.sha256);
    expect(requests).toHaveLength(1);
  });

  it('answers a cache-only call from the store and refuses to download on a miss', async () => {
    servePdf();

    await expect(fetchPdf(deps, URL_A, { cacheOnly: true })).rejects.toMatchObject({
      code: 'CACHE_MISS',
    });
    expect(requests).toHaveLength(0);

    await fetchPdf(deps, URL_A);
    server.resetHandlers();

    expect((await fetchPdf(deps, URL_A, { cacheOnly: true })).hit).toBe(true);
    expect(requests).toHaveLength(1);
  });

  it('refetches when forced', async () => {
    servePdf();
    await fetchPdf(deps, URL_A);

    const forced = await fetchPdf(deps, URL_A, { force: true });

    expect(forced.hit).toBe(false);
    expect(requests).toHaveLength(2);
  });

  it('sends a fixed user agent', async () => {
    let agent: string | null = null;
    server.use(
      onGet(URL_A, (request) => {
        agent = request.headers.get('user-agent');
        return bytesBody(pdfBytes);
      }),
    );

    await fetchPdf(deps, URL_A);

    expect(agent).toBe(DEFAULT_USER_AGENT);
  });

  it('follows absolute and relative redirects', async () => {
    server.use(
      onGet(URL_A, () => statusBody(301, { location: 'https://cdn.test/x.pdf' })),
      onGet('https://cdn.test/x.pdf', () => statusBody(302, { location: '/final.pdf' })),
      onGet('https://cdn.test/final.pdf', () => bytesBody(pdfBytes)),
    );

    const result = await fetchPdf(deps, URL_A);

    expect(result.bytes.equals(pdfBytes)).toBe(true);
  });

  it('stops after too many redirects', async () => {
    server.use(
      onGet('https://loop.test/*', () => statusBody(302, { location: 'https://loop.test/next' })),
    );

    await expect(fetchPdf(deps, 'https://loop.test/start')).rejects.toMatchObject({
      code: 'PDF_TOO_MANY_REDIRECTS',
      details: { maxRedirects: DEFAULT_MAX_REDIRECTS },
    });
  });

  it('rejects a redirect with no location', async () => {
    server.use(onGet(URL_A, () => statusBody(302)));

    await expect(fetchPdf(deps, URL_A)).rejects.toMatchObject({ code: 'PDF_REDIRECT_INVALID' });
  });

  it('rejects a 404 without retrying', async () => {
    let calls = 0;
    server.use(
      onGet(URL_A, () => {
        calls += 1;
        return statusBody(404);
      }),
    );

    await expect(fetchPdf(deps, URL_A)).rejects.toMatchObject({
      code: 'PDF_FETCH_FAILED',
      details: { status: 404 },
    });
    expect(calls).toBe(1);
  });

  it.each([500, 503, 429, 408])('retries status %d and succeeds', async (status) => {
    let calls = 0;
    server.use(
      onGet(URL_A, () => {
        calls += 1;
        return calls === 1 ? statusBody(status) : bytesBody(pdfBytes);
      }),
    );

    const result = await fetchPdf(deps, URL_A);

    expect(calls).toBe(2);
    expect(result.bytes.equals(pdfBytes)).toBe(true);
    expect(delays).toEqual([250]);
  });

  it('gives up after the attempt limit with backoff between tries', async () => {
    let calls = 0;
    server.use(
      onGet(URL_A, () => {
        calls += 1;
        return statusBody(502);
      }),
    );

    await expect(fetchPdf(deps, URL_A)).rejects.toMatchObject({
      code: 'PDF_FETCH_FAILED',
      details: { status: 502, attempts: DEFAULT_MAX_ATTEMPTS },
    });
    expect(calls).toBe(DEFAULT_MAX_ATTEMPTS);
    expect(delays).toEqual([250, 500]);
  });

  it('retries a network failure and succeeds', async () => {
    let calls = 0;
    server.use(
      onGet(URL_A, () => {
        calls += 1;
        return calls === 1 ? networkError() : bytesBody(pdfBytes);
      }),
    );

    await expect(fetchPdf(deps, URL_A)).resolves.toMatchObject({ size: pdfBytes.length });
    expect(calls).toBe(2);
  });

  it('reports a network failure that never recovers, keeping the cause', async () => {
    server.use(onGet(URL_A, () => networkError()));

    await expect(fetchPdf(deps, URL_A)).rejects.toMatchObject({
      code: 'PDF_FETCH_FAILED',
      details: { attempts: DEFAULT_MAX_ATTEMPTS },
    });
    try {
      await fetchPdf(deps, URL_A);
    } catch (error) {
      expect((error as PdfFetchError).cause).toBeInstanceOf(Error);
    }
  });

  it('rejects a response that is not a PDF by content type', async () => {
    server.use(onGet(URL_A, () => htmlBody('<html>bot wall</html>')));

    await expect(fetchPdf(deps, URL_A)).rejects.toMatchObject({
      code: 'PDF_CONTENT_TYPE',
      details: { contentType: expect.stringContaining('text/html') as string },
    });
  });

  it.each([
    'application/octet-stream',
    'binary/octet-stream',
    'application/x-pdf',
    'application/pdf; charset=binary',
  ])('accepts content type %s', async (contentType) => {
    servePdf(URL_A, pdfBytes, { 'content-type': contentType });

    await expect(fetchPdf(deps, URL_A)).resolves.toMatchObject({ size: pdfBytes.length });
  });

  it('accepts a response with no content type', async () => {
    server.use(onGet(URL_A, () => untypedBody(pdfBytes)));

    await expect(fetchPdf(deps, URL_A)).resolves.toMatchObject({ size: pdfBytes.length });
  });

  it('rejects bytes that are not a PDF', async () => {
    servePdf(URL_A, Buffer.from('<html>not a pdf at all</html>'));

    await expect(fetchPdf(deps, URL_A)).rejects.toMatchObject({
      code: 'PDF_NOT_A_PDF',
      details: { firstBytes: '<html>no' },
    });
    expect(PDF_MAGIC).toBe('%PDF-');
  });

  it('rejects a declared size over the cap before downloading', async () => {
    servePdf(URL_A, pdfBytes, { 'content-length': String(DEFAULT_MAX_PDF_BYTES + 1) });

    await expect(fetchPdf(deps, URL_A, { maxBytes: 100 })).rejects.toMatchObject({
      code: 'PDF_TOO_LARGE',
      details: { maxBytes: 100 },
    });
  });

  it('rejects a body over the cap when no size was declared', async () => {
    // A chunked body carries no content-length, so the cap is enforced on the
    // bytes actually received rather than on the declared size.
    server.use(onGet(URL_A, () => streamedBody(pdfBytes)));

    await expect(fetchPdf(deps, URL_A, { maxBytes: 10 })).rejects.toMatchObject({
      code: 'PDF_TOO_LARGE',
      details: { size: pdfBytes.length, maxBytes: 10 },
    });
  });

  it('accepts a response that carries no content type at all', async () => {
    // Undici omits content-type for a raw body, which msw always supplies, so
    // this case is driven through the injected fetch seam.
    const injected = (): Promise<Response> =>
      Promise.resolve(new Response(new Uint8Array(pdfBytes)));

    const result = await fetchPdf({ cache, store, fetch: injected }, URL_A);

    expect(result.size).toBe(pdfBytes.length);
    expect(result.hit).toBe(false);
  });

  it('uses the real fetch when none is injected', async () => {
    servePdf();

    const result = await fetchPdf({ cache, store }, URL_A);

    expect(result.size).toBe(pdfBytes.length);
  });

  it('uses a real delay when no sleep is injected', async () => {
    let calls = 0;
    server.use(
      onGet(URL_A, () => {
        calls += 1;
        return calls === 1 ? statusBody(500) : bytesBody(pdfBytes);
      }),
    );

    const started = Date.now();
    await fetchPdf({ cache, store }, URL_A);

    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
  });
});
