// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { cleanup, render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach } from 'vitest';

import { App } from '../../src/web/ui/app.js';
import type { Api } from '../../src/web/ui/lib/api.js';

/**
 * Rendering a piece of the application under jsdom.
 *
 * The API is a stub the test writes: every page is a function of what the
 * server said, so a page test is "given this answer, show this".
 */

afterEach(() => {
  cleanup();
});

/** The first of a list a query returned, or a failure that names the query. */
export function first<T>(items: readonly T[], what = 'element'): T {
  const found = items[0];
  if (found === undefined) {
    throw new Error(`expected at least one ${what}`);
  }
  return found;
}

/** Every API method, each refusing until a test says what it should answer. */
export function stubApi(overrides: Partial<Api> = {}): Api {
  const refuse = (name: string) => async (): Promise<never> => {
    await Promise.resolve();
    throw new Error(`the test did not stub ${name}`);
  };
  const base = {
    sources: refuse('sources'),
    health: refuse('health'),
    meta: refuse('meta'),
    parts: refuse('parts'),
    part: refuse('part'),
    coverage: refuse('coverage'),
    datasheets: refuse('datasheets'),
    verifications: refuse('verifications'),
    distribution: refuse('distribution'),
    compare: refuse('compare'),
    alternates: refuse('alternates'),
    runs: refuse('runs'),
    run: refuse('run'),
    ledger: refuse('ledger'),
    ledgerCall: refuse('ledgerCall'),
    overview: refuse('overview'),
    spend: refuse('spend'),
    spendBy: refuse('spendBy'),
    tools: refuse('tools'),
    errors: refuse('errors'),
    evals: refuse('evals'),
    evalReport: refuse('evalReport'),
    evalParameters: refuse('evalParameters'),
    evalFailures: refuse('evalFailures'),
    evalCompare: refuse('evalCompare'),
    golden: refuse('golden'),
    goldenHealth: refuse('goldenHealth'),
    escalations: refuse('escalations'),
    resolveEscalation: refuse('resolveEscalation'),
    correctParameter: refuse('correctParameter'),
    setStatus: refuse('setStatus'),
    audit: refuse('audit'),
    cache: refuse('cache'),
    launches: refuse('launches'),
    launch: refuse('launch'),
    estimate: refuse('estimate'),
    startLaunch: refuse('startLaunch'),
    cancelLaunch: refuse('cancelLaunch'),
    pageImageUrl: (sha256: string, page: number) =>
      `/api/datasheets/${sha256}/pages/${String(page)}/image`,
  } as unknown as Api;
  return { ...base, ...overrides };
}

/**
 * Renders the whole application at an address, with the API stubbed.
 *
 * The shell needs the database list and the vocabulary before any page draws,
 * so those two are answered here and a test says only what its own page asks
 * for.
 */
export function renderApp(path: string, overrides: Partial<Api> = {}): RenderResult {
  const api = stubApi({
    sources: () =>
      Promise.resolve({
        sources: [
          {
            id: 'live',
            kind: 'live',
            label: 'live store',
            exists: true,
            writable: true,
            bytes: 1024,
            modifiedAt: '2026-09-12T00:00:00Z',
          },
        ],
      }),
    meta: () =>
      Promise.resolve({
        parameterKeys: ['vinMin', 'vinMax'],
        classificationAxes: ['vinClass'],
        partStatuses: ['extracted', 'verified'],
        prompts: ['extract.v1'],
        model: 'claude-opus-5',
        version: '1.0.0-test',
      }),
    ...overrides,
  });
  globalThis.history.replaceState({}, '', path);
  return render(<App api={api} />);
}

/** Renders a component at a given address, since pages read the URL. */
export function renderAt(element: ReactElement, path = '/'): RenderResult {
  globalThis.history.replaceState({}, '', path);
  return render(element);
}
