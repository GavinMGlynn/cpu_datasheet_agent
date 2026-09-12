import { ChipAgentError } from '../../errors.js';

/**
 * Thrown for a route table that cannot be built and for a request path that
 * is not a path. Both are `WEB_` codes so the error mapper can tell a
 * programmer's mistake (a bad pattern, thrown at startup) from a client's
 * (a malformed escape, thrown per request).
 */
export class RouteError extends ChipAgentError {}

export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export function isHttpMethod(value: string): value is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(value);
}

/** Decoded path parameters. `:mpn` in a pattern arrives here under `mpn`. */
export type RouteParams = Readonly<Record<string, string>>;

type Segment =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'param'; readonly name: string }
  | { readonly kind: 'rest'; readonly name: string };

interface CompiledRoute<H> {
  readonly method: HttpMethod;
  readonly pattern: string;
  readonly segments: readonly Segment[];
  readonly handler: H;
}

export type RouteLookup<H> =
  | {
      readonly kind: 'found';
      readonly handler: H;
      readonly params: RouteParams;
      /** The pattern that matched, for logging and metrics rather than for logic. */
      readonly pattern: string;
    }
  | { readonly kind: 'method_not_allowed'; readonly allow: readonly HttpMethod[] }
  | { readonly kind: 'not_found' };

function compile(pattern: string): readonly Segment[] {
  if (!pattern.startsWith('/')) {
    throw new RouteError('WEB_ROUTE_PATTERN', `route pattern must start with "/": ${pattern}`, {
      details: { pattern },
    });
  }
  const parts = splitPath(pattern);
  const segments: Segment[] = [];
  const names = new Set<string>();
  parts.forEach((part, index) => {
    const segment = compileSegment(part, pattern);
    if (segment.kind !== 'literal') {
      if (names.has(segment.name)) {
        throw new RouteError(
          'WEB_ROUTE_PATTERN',
          `route pattern repeats the parameter ":${segment.name}": ${pattern}`,
          { details: { pattern, name: segment.name } },
        );
      }
      names.add(segment.name);
    }
    if (segment.kind === 'rest' && index !== parts.length - 1) {
      throw new RouteError('WEB_ROUTE_PATTERN', `a "*" segment must be last: ${pattern}`, {
        details: { pattern },
      });
    }
    segments.push(segment);
  });
  return Object.freeze(segments);
}

function compileSegment(part: string, pattern: string): Segment {
  if (part.startsWith(':')) {
    return { kind: 'param', name: requireName(part.slice(1), pattern) };
  }
  if (part.startsWith('*')) {
    return { kind: 'rest', name: requireName(part.slice(1), pattern) };
  }
  return { kind: 'literal', value: part };
}

function requireName(name: string, pattern: string): string {
  if (name === '') {
    throw new RouteError(
      'WEB_ROUTE_PATTERN',
      `route pattern has an unnamed parameter: ${pattern}`,
      {
        details: { pattern },
      },
    );
  }
  return name;
}

/**
 * Splits on "/", dropping the empty parts a leading and a trailing slash
 * produce. `/parts/` and `/parts` are the same route: a trailing slash is a
 * typing accident, not a different resource, and redirecting for one is
 * ceremony that only ever surprises the caller.
 */
function splitPath(pathname: string): readonly string[] {
  return pathname.split('/').filter((part) => part !== '');
}

function decode(part: string, pathname: string): string {
  try {
    return decodeURIComponent(part);
  } catch (error) {
    throw new RouteError('WEB_BAD_PATH', `path is not valid percent-encoding: ${pathname}`, {
      cause: error,
      details: { pathname },
    });
  }
}

function match<H>(
  route: CompiledRoute<H>,
  parts: readonly string[],
  pathname: string,
): RouteParams | undefined {
  const params: Record<string, string> = {};
  for (const [index, segment] of route.segments.entries()) {
    if (segment.kind === 'rest') {
      params[segment.name] = parts
        .slice(index)
        .map((part) => decode(part, pathname))
        .join('/');
      return params;
    }
    const part = parts[index];
    if (part === undefined) {
      return undefined;
    }
    if (segment.kind === 'literal') {
      if (decode(part, pathname) !== segment.value) {
        return undefined;
      }
      continue;
    }
    params[segment.name] = decode(part, pathname);
  }
  return parts.length === route.segments.length ? params : undefined;
}

/**
 * The route table.
 *
 * Registration order decides precedence, so a literal registered before a
 * parameter wins: `/api/runs/active` added before `/api/runs/:id` resolves
 * "active" to the literal. That is a rule to know rather than to guess at,
 * which is why it is stated here and tested.
 *
 * `HEAD` falls back to a `GET` route when no `HEAD` route is registered.
 * Suppressing the body is the responder's job, not the router's.
 */
export class Router<H> {
  private readonly routes: CompiledRoute<H>[] = [];

  add(method: HttpMethod, pattern: string, handler: H): this {
    this.routes.push({ method, pattern, segments: compile(pattern), handler });
    return this;
  }

  get(pattern: string, handler: H): this {
    return this.add('GET', pattern, handler);
  }

  post(pattern: string, handler: H): this {
    return this.add('POST', pattern, handler);
  }

  patch(pattern: string, handler: H): this {
    return this.add('PATCH', pattern, handler);
  }

  put(pattern: string, handler: H): this {
    return this.add('PUT', pattern, handler);
  }

  delete(pattern: string, handler: H): this {
    return this.add('DELETE', pattern, handler);
  }

  /** Every registered pattern, in registration order. */
  patterns(): readonly string[] {
    return this.routes.map((route) => `${route.method} ${route.pattern}`);
  }

  find(method: string, pathname: string): RouteLookup<H> {
    const parts = splitPath(pathname);
    const wanted = method === 'HEAD' ? ['HEAD', 'GET'] : [method];
    const allow = new Set<HttpMethod>();
    for (const candidate of wanted) {
      for (const route of this.routes) {
        const params = match(route, parts, pathname);
        if (params === undefined) {
          continue;
        }
        if (route.method === candidate) {
          return { kind: 'found', handler: route.handler, params, pattern: route.pattern };
        }
        allow.add(route.method);
      }
    }
    if (allow.size === 0) {
      return { kind: 'not_found' };
    }
    if (allow.has('GET')) {
      allow.add('HEAD');
    }
    return {
      kind: 'method_not_allowed',
      allow: HTTP_METHODS.filter((candidate) => allow.has(candidate)),
    };
  }
}
