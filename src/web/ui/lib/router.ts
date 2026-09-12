import { useCallback, useEffect, useState } from 'react';

/**
 * The address bar, as a hook.
 *
 * Real paths rather than hashes, because the server already serves the
 * application shell for any path that is not a file: a deep link to a part
 * reloads into the same page, and a link to a run can be pasted into a
 * message (see the static handler).
 */

export interface Route {
  /** Path segments, decoded: `/parts/TPS54331DR` is `['parts', 'TPS54331DR']`. */
  readonly segments: readonly string[];
  readonly query: URLSearchParams;
  readonly path: string;
}

export function parseRoute(href: string): Route {
  const url = new URL(href, 'http://application.invalid');
  return {
    segments: url.pathname
      .split('/')
      .filter((part) => part !== '')
      .map(decodeURIComponent),
    query: url.searchParams,
    path: url.pathname,
  };
}

export function useRoute(): Route {
  const [href, setHref] = useState(() => globalThis.location.href);
  useEffect(() => {
    const update = (): void => {
      setHref(globalThis.location.href);
    };
    globalThis.addEventListener('popstate', update);
    globalThis.addEventListener('chip:navigate', update);
    return () => {
      globalThis.removeEventListener('popstate', update);
      globalThis.removeEventListener('chip:navigate', update);
    };
  }, []);
  return parseRoute(href);
}

/**
 * Goes somewhere, and tells the application it happened.
 *
 * `pushState` does not fire an event of its own, so one is dispatched here;
 * that is the whole of the router.
 */
export function navigate(path: string): void {
  globalThis.history.pushState({}, '', path);
  globalThis.dispatchEvent(new Event('chip:navigate'));
}

/** Replaces the current entry, for a filter change that should not stack up. */
export function replace(path: string): void {
  globalThis.history.replaceState({}, '', path);
  globalThis.dispatchEvent(new Event('chip:navigate'));
}

export function useNavigate(): (path: string) => void {
  return useCallback((path: string) => {
    navigate(path);
  }, []);
}

/** The current path with these query parameters changed and the rest kept. */
export function withQuery(
  route: Route,
  changes: Readonly<Record<string, string | number | boolean | undefined>>,
): string {
  const search = new URLSearchParams(route.query);
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined || value === '') {
      search.delete(key);
    } else {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text === '' ? route.path : `${route.path}?${text}`;
}

export function href(
  segments: readonly string[],
  params: URLSearchParams = new URLSearchParams(),
): string {
  const path = `/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
  const text = params.toString();
  return text === '' ? path : `${path}?${text}`;
}
