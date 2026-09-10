import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { DigiKeyError } from './errors.js';

/** Token endpoints. The token lives 600 seconds, so refresh-ahead is mandatory. */
export const PRODUCTION_HOST = 'https://api.digikey.com';
export const SANDBOX_HOST = 'https://sandbox-api.digikey.com';
export const TOKEN_PATH = '/v1/oauth2/token';
export const DEFAULT_REFRESH_MARGIN_MS = 60_000;

const TokenResponse = z.looseObject({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  token_type: z.string(),
});

export const StoredToken = z.strictObject({
  accessToken: z.string().min(1),
  /** ISO 8601 instant at which the token stops being usable. */
  expiresAt: z.iso.datetime(),
  /** Identifies the credentials the token was issued for, without storing them. */
  clientFingerprint: z.string().length(16),
});
export type StoredToken = z.output<typeof StoredToken>;

export interface TokenStore {
  read(): Promise<StoredToken | undefined>;
  write(token: StoredToken): Promise<void>;
}

/** Keeps the token in `DATA_DIR/tokens/digikey.json`, readable only by its owner. */
export class FileTokenStore implements TokenStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<StoredToken | undefined> {
    let text: string;
    try {
      text = await readFile(this.filePath, 'utf8');
    } catch {
      return undefined;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return undefined;
    }
    const result = StoredToken.safeParse(parsed);
    return result.success ? result.data : undefined;
  }

  async write(token: StoredToken): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    await writeFile(this.filePath, JSON.stringify(token), { encoding: 'utf8', mode: 0o600 });
  }
}

/** Keeps the token in memory only. The default when no directory is configured. */
export class MemoryTokenStore implements TokenStore {
  private token: StoredToken | undefined;

  read(): Promise<StoredToken | undefined> {
    return Promise.resolve(this.token);
  }

  write(token: StoredToken): Promise<void> {
    this.token = token;
    return Promise.resolve();
  }
}

export type TokenFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string },
) => Promise<Response>;

export interface TokenClientOptions {
  readonly clientId: string | undefined;
  readonly clientSecret: string | undefined;
  readonly sandbox?: boolean;
  readonly store?: TokenStore;
  readonly fetch?: TokenFetch;
  readonly clock?: () => Date;
  /** Refresh this long before expiry. Default 60 000 ms of the 600 000 ms lifetime. */
  readonly refreshMarginMs?: number;
}

export function fingerprint(clientId: string): string {
  return createHash('sha256').update(clientId).digest('hex').slice(0, 16);
}

/**
 * Obtains and caches a Digi-Key access token using the 2-legged
 * client-credentials flow.
 *
 * The token is refreshed before it expires rather than after a 401, because
 * its 600-second lifetime is shorter than a single extraction run.
 * Concurrent callers share one in-flight request.
 */
export class DigiKeyTokenClient {
  private readonly store: TokenStore;
  private readonly doFetch: TokenFetch;
  private readonly clock: () => Date;
  private readonly refreshMarginMs: number;
  private inflight: Promise<string> | undefined;

  constructor(private readonly options: TokenClientOptions) {
    this.store = options.store ?? new MemoryTokenStore();
    this.doFetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.clock = options.clock ?? ((): Date => new Date());
    this.refreshMarginMs = options.refreshMarginMs ?? DEFAULT_REFRESH_MARGIN_MS;
  }

  get host(): string {
    return this.options.sandbox === true ? SANDBOX_HOST : PRODUCTION_HOST;
  }

  /** Throws `DIGIKEY_CREDENTIALS_MISSING` unless both halves are configured. */
  private credentials(): { clientId: string; clientSecret: string } {
    const { clientId, clientSecret } = this.options;
    if (clientId === undefined || clientSecret === undefined) {
      throw new DigiKeyError(
        'DIGIKEY_CREDENTIALS_MISSING',
        'set DIGIKEY_CLIENT_ID and DIGIKEY_CLIENT_SECRET in .env to use the Digi-Key API',
        {
          details: {
            hasClientId: clientId !== undefined,
            hasClientSecret: clientSecret !== undefined,
          },
        },
      );
    }
    return { clientId, clientSecret };
  }

  /** The configured client id, or `DIGIKEY_CREDENTIALS_MISSING` if there is none. */
  get clientId(): string {
    return this.credentials().clientId;
  }

  /**
   * True when a stored token was issued for these credentials and is still
   * outside the refresh margin.
   */
  private isUsable(token: StoredToken, clientId: string): boolean {
    return (
      token.clientFingerprint === fingerprint(clientId) &&
      Date.parse(token.expiresAt) - this.refreshMarginMs > this.clock().getTime()
    );
  }

  /** A usable token, from cache when one is still fresh. `force` discards the cached token. */
  async getToken(force = false): Promise<string> {
    const { clientId } = this.credentials();
    if (!force) {
      const cached = await this.store.read();
      if (cached !== undefined && this.isUsable(cached, clientId)) {
        return cached.accessToken;
      }
    }
    this.inflight ??= this.request().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async request(): Promise<string> {
    const { clientId, clientSecret } = this.credentials();
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }).toString();

    let response: Response;
    try {
      response = await this.doFetch(`${this.host}${TOKEN_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body,
      });
    } catch (error) {
      throw new DigiKeyError('DIGIKEY_TOKEN_FAILED', 'cannot reach the Digi-Key token endpoint', {
        cause: error,
        details: { host: this.host },
      });
    }

    const text = await response.text();
    if (!response.ok) {
      throw new DigiKeyError(
        'DIGIKEY_TOKEN_FAILED',
        `the Digi-Key token endpoint returned ${String(response.status)}`,
        { details: { host: this.host, status: response.status, body: text.slice(0, 300) } },
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new DigiKeyError(
        'DIGIKEY_TOKEN_FAILED',
        'the token endpoint returned text that is not JSON',
        {
          cause: error,
          details: { host: this.host, body: text.slice(0, 300) },
        },
      );
    }
    const result = TokenResponse.safeParse(parsed);
    if (!result.success) {
      throw new DigiKeyError(
        'DIGIKEY_TOKEN_FAILED',
        'the token endpoint returned an unexpected shape',
        {
          details: { host: this.host, issues: result.error.issues.map((issue) => issue.message) },
        },
      );
    }

    const token: StoredToken = {
      accessToken: result.data.access_token,
      expiresAt: new Date(this.clock().getTime() + result.data.expires_in * 1000).toISOString(),
      clientFingerprint: fingerprint(clientId),
    };
    await this.store.write(token);
    return token.accessToken;
  }
}
