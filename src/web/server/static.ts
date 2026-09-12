import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { RequestContext } from './app.js';
import { WebError } from './errors.js';
import { sendEmpty, type CachePolicy } from './respond.js';

/** Extensions the application is built from. Anything else is refused rather than guessed at. */
export const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.wasm': 'application/wasm',
});

/** A file name carrying a content hash, which may be cached for ever. */
const HASHED = /\.[0-9a-f]{8,}\.[a-z0-9]+$/u;

export function contentTypeOf(file: string): string {
  const type = CONTENT_TYPES[path.extname(file).toLowerCase()];
  if (type === undefined) {
    throw new WebError(
      415,
      'WEB_UNSERVED_TYPE',
      `this server does not serve ${path.extname(file)}`,
    );
  }
  return type;
}

export function policyFor(file: string): CachePolicy {
  return HASHED.test(path.basename(file)) ? 'asset' : 'live';
}

export interface StaticOptions {
  /** Directory the built application lives in. */
  readonly dir: string;
  readonly index?: string;
  /** Injected in tests. Defaults to reading from disk. */
  readonly read?: (file: string) => Promise<Uint8Array>;
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR';
}

/**
 * Trades a valid token in the query for a cookie and a redirect to the same
 * path without it, so the token stops living in the address bar, the history
 * and every `Referer` the page later sends (D67). Returns false when there
 * was no token to trade.
 *
 * Separate from serving the page because signing in must work before the
 * front end is built: otherwise a fresh checkout has no way in at all.
 */
export function tradeTokenForCookie(context: RequestContext): boolean {
  if (context.query.get('token') === null || !context.auth.authenticated) {
    return false;
  }
  const clean = new URL(context.url.href);
  clean.searchParams.delete('token');
  sendEmpty(context.response, 303, {
    Location: `${clean.pathname}${clean.search}`,
    'Set-Cookie': context.security.sessionCookies(),
    'Cache-Control': 'no-store',
  });
  return true;
}

/**
 * Serves the built application.
 *
 * A path with no extension that does not exist gets `index.html`, because
 * the application routes in the browser and a reload of `/runs/abc` must not
 * 404. A request carrying a valid token is handed a cookie first; see
 * {@link tradeTokenForCookie}.
 */
export function createStaticHandler(
  options: StaticOptions,
): (context: RequestContext) => Promise<void> {
  const root = path.resolve(options.dir);
  const index = options.index ?? 'index.html';
  const read = options.read ?? ((file: string) => readFile(file));

  const serve = async (context: RequestContext, file: string): Promise<void> => {
    const bytes = await read(file);
    context.respond.bytes(context.response, context.facts, bytes, contentTypeOf(file), {
      policy: policyFor(file),
    });
  };

  const serveIndex = async (context: RequestContext): Promise<void> => {
    if (tradeTokenForCookie(context)) {
      return;
    }
    await serve(context, path.join(root, index));
  };

  return async function handleStatic(context: RequestContext): Promise<void> {
    const requested = context.params.path ?? '';
    if (requested === '') {
      await serveIndex(context);
      return;
    }
    const target = path.resolve(root, requested);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new WebError(403, 'WEB_PATH_ESCAPE', `${requested} is outside the served directory`);
    }
    try {
      await serve(context, target);
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
      if (path.extname(requested) !== '') {
        throw new WebError(404, 'WEB_ASSET_NOT_FOUND', `no asset at ${requested}`, {
          cause: error,
        });
      }
      await serveIndex(context);
    }
  };
}
