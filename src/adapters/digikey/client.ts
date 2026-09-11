import type { z } from 'zod';

import { DigiKeyError } from './errors.js';
import { DigiKeyTokenClient, PRODUCTION_HOST, SANDBOX_HOST, type TokenStore } from './token.js';

export interface DigiKeyLocale {
  readonly site: string;
  readonly language: string;
  readonly currency: string;
}

export type ApiFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<Response>;

export interface DigiKeyClientOptions {
  readonly clientId: string | undefined;
  readonly clientSecret: string | undefined;
  readonly sandbox?: boolean;
  readonly locale: DigiKeyLocale;
  readonly fetch?: ApiFetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly clock?: () => Date;
  readonly tokenStore?: TokenStore;
  readonly tokenClient?: DigiKeyTokenClient;
  /** Minimum gap between requests. Default 250 ms, so bursts never exceed four per second. */
  readonly minIntervalMs?: number;
  /** Attempts per request, including the first. Default 3. */
  readonly maxAttempts?: number;
}

export interface RateLimitSnapshot {
  /** Calls allowed per day, as last reported. */
  readonly limit: number | undefined;
  readonly remaining: number | undefined;
  readonly observedAt: string | undefined;
}

export interface RequestSpec {
  readonly method: 'GET' | 'POST';
  /** Path below the host, starting with a slash. */
  readonly path: string;
  readonly body?: unknown;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

/**
 * The wait used when no sleep is injected. Exported so a test can cover it
 * directly: reaching it through the throttle needs a request to finish faster
 * than the minimum interval, which a loaded machine does not guarantee.
 */
export const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function numberHeader(response: Response, name: string): number | undefined {
  const raw = response.headers.get(name);
  if (raw === null) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * The request layer for Product Information v4.
 *
 * Requests are serialised with a minimum gap so a burst cannot trip the
 * per-second limit, a 401 refreshes the token once and retries, and 408, 429,
 * and 5xx are retried with exponential backoff honouring `Retry-After`. Every
 * response is validated against its schema before it leaves this class.
 */
export class DigiKeyClient {
  private readonly tokens: DigiKeyTokenClient;
  private readonly doFetch: ApiFetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly clock: () => Date;
  private readonly minIntervalMs: number;
  private readonly maxAttempts: number;
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;
  private snapshot: RateLimitSnapshot = {
    limit: undefined,
    remaining: undefined,
    observedAt: undefined,
  };

  constructor(private readonly options: DigiKeyClientOptions) {
    this.tokens =
      options.tokenClient ??
      new DigiKeyTokenClient({
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        ...(options.sandbox === undefined ? {} : { sandbox: options.sandbox }),
        ...(options.tokenStore === undefined ? {} : { store: options.tokenStore }),
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        ...(options.clock === undefined ? {} : { clock: options.clock }),
      });
    this.doFetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.sleep = options.sleep ?? defaultSleep;
    this.clock = options.clock ?? ((): Date => new Date());
    this.minIntervalMs = options.minIntervalMs ?? 250;
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  get host(): string {
    return this.options.sandbox === true ? SANDBOX_HOST : PRODUCTION_HOST;
  }

  /** Daily quota as last reported by the API. Undefined until the first call. */
  get rateLimit(): RateLimitSnapshot {
    return this.snapshot;
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
    const url = `${this.host}${spec.path}`;
    let refreshed = false;

    for (let attempt = 1; ; attempt += 1) {
      await this.pace();
      const token = await this.tokens.getToken(refreshed);
      const headers: Record<string, string> = {
        authorization: `Bearer ${token}`,
        'X-DIGIKEY-Client-Id': this.tokens.clientId,
        'X-DIGIKEY-Locale-Site': this.options.locale.site,
        'X-DIGIKEY-Locale-Language': this.options.locale.language,
        'X-DIGIKEY-Locale-Currency': this.options.locale.currency,
        accept: 'application/json',
      };
      if (spec.body !== undefined) {
        headers['content-type'] = 'application/json';
      }

      let response: Response;
      try {
        response = await this.doFetch(url, {
          method: spec.method,
          headers,
          ...(spec.body === undefined ? {} : { body: JSON.stringify(spec.body) }),
        });
      } catch (error) {
        if (attempt >= this.maxAttempts) {
          throw new DigiKeyError('DIGIKEY_REQUEST_FAILED', `cannot reach ${url}`, {
            cause: error,
            details: { url, attempts: this.maxAttempts },
          });
        }
        await this.sleep(2 ** (attempt - 1) * 500);
        continue;
      }

      this.snapshot = {
        limit: numberHeader(response, 'x-ratelimit-limit') ?? this.snapshot.limit,
        remaining: numberHeader(response, 'x-ratelimit-remaining') ?? this.snapshot.remaining,
        observedAt: this.clock().toISOString(),
      };

      if (response.status === 401 && !refreshed) {
        // The token may have expired mid-run; take a fresh one and try again.
        refreshed = true;
        continue;
      }
      if (response.status === 404) {
        throw new DigiKeyError('DIGIKEY_NOT_FOUND', `Digi-Key does not list ${spec.path}`, {
          details: { url, status: 404 },
        });
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
        const code = response.status === 429 ? 'DIGIKEY_RATE_LIMITED' : 'DIGIKEY_REQUEST_FAILED';
        const retryAfter = Number(response.headers.get('retry-after'));
        throw new DigiKeyError(code, `${url} returned ${String(response.status)}`, {
          details: {
            url,
            status: response.status,
            body,
            attempts: attempt,
            ...(Number.isFinite(retryAfter) && retryAfter > 0
              ? { retryAfterSeconds: retryAfter }
              : {}),
            ...(this.snapshot.remaining === undefined
              ? {}
              : { remaining: this.snapshot.remaining }),
          },
        });
      }

      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        throw new DigiKeyError(
          'DIGIKEY_RESPONSE_INVALID',
          `${url} returned text that is not JSON`,
          {
            cause: error,
            details: { url, body: text.slice(0, 300) },
          },
        );
      }
      const result = schema.safeParse(parsed);
      if (!result.success) {
        throw new DigiKeyError('DIGIKEY_RESPONSE_INVALID', `${url} returned an unexpected shape`, {
          details: {
            url,
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
