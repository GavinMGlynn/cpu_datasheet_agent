import type { z } from 'zod';

import { MouserError } from './errors.js';
import type { MouserApiError } from './schemas.js';

export const MOUSER_HOST = 'https://api.mouser.com';
export const SEARCH_BASE = '/api/v1/search';

export type ApiFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<Response>;

export interface MouserClientOptions {
  readonly apiKey: string | undefined;
  readonly fetch?: ApiFetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly clock?: () => Date;
  /** Minimum gap between requests. Default 250 ms. */
  readonly minIntervalMs?: number;
  /** Attempts per request, including the first. Default 3. */
  readonly maxAttempts?: number;
  readonly host?: string;
}

export interface RequestSpec {
  /** Path below the host, starting with a slash. */
  readonly path: string;
  readonly body: unknown;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function describeErrors(errors: readonly MouserApiError[]): string {
  return errors
    .map((error) => [error.PropertyName, error.Message ?? error.Code].filter(Boolean).join(': '))
    .join('; ');
}

/**
 * The request layer for the Mouser Search API.
 *
 * Two things differ from a conventional REST client and both are load-bearing.
 * The key travels as an `apiKey` query parameter rather than a header, and
 * **a rejected request still returns HTTP 200** with an `Errors` array, so the
 * status code alone never means success. Every response is checked for that
 * array before it is validated.
 */
export class MouserClient {
  private readonly doFetch: ApiFetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly clock: () => Date;
  private readonly minIntervalMs: number;
  private readonly maxAttempts: number;
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(private readonly options: MouserClientOptions) {
    this.doFetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.sleep = options.sleep ?? defaultSleep;
    this.clock = options.clock ?? ((): Date => new Date());
    this.minIntervalMs = options.minIntervalMs ?? 250;
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  get host(): string {
    return this.options.host ?? MOUSER_HOST;
  }

  /** Throws `MOUSER_KEY_MISSING` unless a key is configured. */
  private key(): string {
    const apiKey = this.options.apiKey;
    if (apiKey === undefined) {
      throw new MouserError(
        'MOUSER_KEY_MISSING',
        'set MOUSER_API_KEY in .env to use the Mouser Search API. The Search API key is a separate registration from the Order and Cart keys.',
        { details: {} },
      );
    }
    return apiKey;
  }

  /** Sends a request and validates the response. Calls are serialised and paced. */
  request<S extends z.ZodType>(schema: S, spec: RequestSpec): Promise<z.output<S>> {
    const run = this.queue.then(() => this.send(schema, spec));
    this.queue = run.catch((): void => undefined);
    return run;
  }

  private async pace(): Promise<void> {
    const waited = this.clock().getTime() - this.lastRequestAt;
    if (this.lastRequestAt !== 0 && waited < this.minIntervalMs) {
      await this.sleep(this.minIntervalMs - waited);
    }
    this.lastRequestAt = this.clock().getTime();
  }

  private async send<S extends z.ZodType>(schema: S, spec: RequestSpec): Promise<z.output<S>> {
    const apiKey = this.key();
    // The key is a query parameter, so it must never appear in an error message.
    const shown = `${this.host}${spec.path}`;
    const url = `${shown}?apiKey=${encodeURIComponent(apiKey)}`;

    for (let attempt = 1; ; attempt += 1) {
      await this.pace();
      let response: Response;
      try {
        response = await this.doFetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(spec.body),
        });
      } catch (error) {
        if (attempt >= this.maxAttempts) {
          throw new MouserError('MOUSER_REQUEST_FAILED', `cannot reach ${shown}`, {
            cause: error,
            details: { url: shown, attempts: this.maxAttempts },
          });
        }
        await this.sleep(2 ** (attempt - 1) * 500);
        continue;
      }

      if (RETRYABLE.has(response.status) && attempt < this.maxAttempts) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const delay =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 2 ** (attempt - 1) * 500;
        await this.sleep(delay);
        continue;
      }
      if (!response.ok) {
        const body = (await response.text()).slice(0, 300);
        const code = response.status === 429 ? 'MOUSER_RATE_LIMITED' : 'MOUSER_REQUEST_FAILED';
        throw new MouserError(code, `${shown} returned ${String(response.status)}`, {
          details: { url: shown, status: response.status, body, attempts: attempt },
        });
      }

      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        throw new MouserError(
          'MOUSER_RESPONSE_INVALID',
          `${shown} returned text that is not JSON`,
          {
            cause: error,
            details: { url: shown, body: text.slice(0, 300) },
          },
        );
      }

      const result = schema.safeParse(parsed);
      if (!result.success) {
        throw new MouserError('MOUSER_RESPONSE_INVALID', `${shown} returned an unexpected shape`, {
          details: {
            url: shown,
            issues: result.error.issues
              .slice(0, 5)
              .map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`),
          },
        });
      }
      return result.data;
    }
  }
}

/**
 * Rejects a response that carries an `Errors` array.
 *
 * Mouser reports a bad key, a malformed request, and a quota breach the same
 * way: HTTP 200 with errors in the body. Calling this is not optional.
 */
export function assertNoApiErrors(errors: readonly MouserApiError[], path: string): void {
  if (errors.length === 0) {
    return;
  }
  throw new MouserError('MOUSER_API_ERROR', `${path} reported: ${describeErrors(errors)}`, {
    details: {
      path,
      errors: errors.map((error) => ({
        ...(error.Code === undefined ? {} : { code: error.Code }),
        ...(error.Message === undefined ? {} : { message: error.Message }),
      })),
    },
  });
}
