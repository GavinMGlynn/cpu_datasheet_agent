import { createHash } from 'node:crypto';

import { bytesCodec, type Cache } from '../cache/index.js';
import type { FileCacheStore } from '../cache/store.js';
import { ChipAgentError } from '../errors.js';

export class PdfFetchError extends ChipAgentError {}

export const PDF_NAMESPACE = 'pdf';
export const PDF_MAGIC = '%PDF-';
export const DEFAULT_MAX_PDF_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_REDIRECTS = 5;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_USER_AGENT =
  'chip-datasheet-agent/0.1 (+https://github.com/GavinMGlynn/cpu_datasheet_agent)';

/** Content types a PDF response may carry. Anything else is a mismatch. */
const ACCEPTED_CONTENT_TYPES = [
  'application/pdf',
  'application/octet-stream',
  'binary/octet-stream',
  'application/x-pdf',
];

export type FetchLike = (
  url: string,
  init: { redirect: 'manual'; headers: Record<string, string> },
) => Promise<Response>;

export interface FetchPdfOptions {
  readonly maxBytes?: number;
  readonly maxRedirects?: number;
  readonly maxAttempts?: number;
  readonly userAgent?: string;
  /** Bypass the cached copy and refetch. */
  readonly force?: boolean;
}

export interface FetchedPdf {
  /** URL as requested. */
  readonly url: string;
  /** Path of the cached PDF on disk. */
  readonly localPath: string;
  readonly sha256: string;
  readonly bytes: Buffer;
  readonly size: number;
  /** True when served from the cache without a request. */
  readonly hit: boolean;
}

export interface PdfFetcherDeps {
  readonly cache: Cache;
  readonly store: FileCacheStore;
  readonly fetch?: FetchLike;
  /** Delay between retries. Injected so tests do not wait. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function contentTypeAcceptable(header: string | null): boolean {
  if (header === null) {
    return true;
  }
  const type = header.replace(/;.*/s, '').trim().toLowerCase();
  return type === '' || ACCEPTED_CONTENT_TYPES.includes(type);
}

async function readCapped(response: Response, maxBytes: number, url: string): Promise<Buffer> {
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) {
    throw new PdfFetchError(
      'PDF_TOO_LARGE',
      `${url} declares ${declared} bytes, over the ${String(maxBytes)} byte limit`,
      { details: { url, declared: Number(declared), maxBytes } },
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) {
    throw new PdfFetchError(
      'PDF_TOO_LARGE',
      `${url} returned ${String(bytes.length)} bytes, over the ${String(maxBytes)} byte limit`,
      { details: { url, size: bytes.length, maxBytes } },
    );
  }
  return bytes;
}

/**
 * Downloads a datasheet PDF through the cache, so a rerun makes no request.
 *
 * Follows redirects up to `maxRedirects`, retries 408, 429, and 5xx responses
 * and network failures up to `maxAttempts` with exponential backoff, enforces
 * a size cap, rejects a non-PDF content type, and checks the `%PDF-` magic
 * bytes. The returned `localPath` is the cached file itself.
 */
export async function fetchPdf(
  deps: PdfFetcherDeps,
  url: string,
  options: FetchPdfOptions = {},
): Promise<FetchedPdf> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_PDF_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const doFetch = deps.fetch ?? ((target, init) => globalThis.fetch(target, init));
  const sleep = deps.sleep ?? defaultSleep;

  /**
   * One request with retries. The loop has no bound of its own so every exit
   * either returns a response or throws; the attempt counter enforces the
   * limit.
   */
  const withRetries = async (target: string): Promise<Response> => {
    for (let attempt = 1; ; attempt += 1) {
      let response: Response | undefined;
      let lastError: unknown;
      try {
        response = await doFetch(target, {
          redirect: 'manual',
          headers: { 'user-agent': userAgent, accept: 'application/pdf,*/*' },
        });
      } catch (error) {
        lastError = error;
      }
      if (response !== undefined && !isRetryable(response.status)) {
        return response;
      }
      if (attempt >= maxAttempts) {
        if (response === undefined) {
          throw new PdfFetchError('PDF_FETCH_FAILED', `cannot fetch ${target}`, {
            cause: lastError,
            details: { url: target, attempts: maxAttempts },
          });
        }
        throw new PdfFetchError(
          'PDF_FETCH_FAILED',
          `${target} returned ${String(response.status)} after ${String(maxAttempts)} attempts`,
          { details: { url: target, status: response.status, attempts: maxAttempts } },
        );
      }
      await sleep(2 ** (attempt - 1) * 250);
    }
  };

  const download = async (): Promise<{ value: Buffer; contentType: string }> => {
    let target = url;
    for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
      const response = await withRetries(target);

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location === null) {
          throw new PdfFetchError(
            'PDF_REDIRECT_INVALID',
            `${target} returned ${String(response.status)} with no location`,
            { details: { url: target, status: response.status } },
          );
        }
        target = new URL(location, target).toString();
        continue;
      }
      if (!response.ok) {
        throw new PdfFetchError(
          'PDF_FETCH_FAILED',
          `${target} returned ${String(response.status)}`,
          {
            details: { url: target, status: response.status },
          },
        );
      }

      const header = response.headers.get('content-type');
      if (!contentTypeAcceptable(header)) {
        throw new PdfFetchError(
          'PDF_CONTENT_TYPE',
          `${target} returned content type ${String(header)}, not a PDF`,
          { details: { url: target, contentType: header } },
        );
      }
      const bytes = await readCapped(response, maxBytes, target);
      if (!bytes.subarray(0, PDF_MAGIC.length).toString('latin1').startsWith(PDF_MAGIC)) {
        throw new PdfFetchError(
          'PDF_NOT_A_PDF',
          `${target} did not return a PDF (missing ${PDF_MAGIC} header)`,
          { details: { url: target, firstBytes: bytes.subarray(0, 8).toString('latin1') } },
        );
      }
      return { value: bytes, contentType: header ?? 'application/pdf' };
    }
    throw new PdfFetchError(
      'PDF_TOO_MANY_REDIRECTS',
      `${url} redirected more than ${String(maxRedirects)} times`,
      { details: { url, maxRedirects } },
    );
  };

  const result = await deps.cache.cached(
    { namespace: PDF_NAMESPACE, params: { url } },
    async () => {
      const { value, contentType } = await download();
      return { value, contentType, sourceUrl: url };
    },
    { codec: bytesCodec, ...(options.force === undefined ? {} : { force: options.force }) },
  );

  return {
    url,
    localPath: deps.store.dataPath({ namespace: PDF_NAMESPACE, hash: result.hash }),
    sha256: createHash('sha256').update(result.value).digest('hex'),
    bytes: result.value,
    size: result.value.length,
    hit: result.hit,
  };
}
