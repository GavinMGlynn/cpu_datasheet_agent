// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderApp } from '../../../test/ui/render.js';
import { App, NAVIGATION, useApp } from './app.js';

/**
 * The shell: which page is showing, which database it is reading, and what it
 * does with an address it does not recognise.
 *
 * Most pages are routed to without stubbing what they load — a page that
 * cannot load still has to render its heading and say what went wrong, which
 * is the thing worth checking here.
 */

describe('routing', () => {
  it('shows the overview at the root', async () => {
    renderApp('/');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    });
  });

  it('has a page behind every link in the sidebar', async () => {
    const headings: Readonly<Record<string, string>> = {
      '/': 'Overview',
      '/parts': 'Catalogue',
      '/parameters': 'Parameters',
      '/compare': 'Compare',
      '/alternates': 'Alternates',
      '/pricing': 'Pricing',
      '/datasheets': 'Datasheets',
      '/escalations': 'Questions',
      '/runs': 'Runs',
      '/costs': 'Cost',
      '/tools': 'Tools',
      '/ledger': 'Ledger',
      '/evals': 'Evaluations',
      '/verification': 'Verification',
      '/golden': 'Golden set',
      '/control': 'Run control',
      '/audit': 'Audit trail',
      '/health': 'Health',
    };
    for (const entry of NAVIGATION) {
      const { unmount } = renderApp(entry.path);
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: headings[entry.path] ?? entry.label }),
        ).toBeInTheDocument();
      });
      unmount();
    }
  });

  it('routes to the detail pages by their address', async () => {
    const { unmount } = renderApp('/parts/TPS54331DR');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'TPS54331DR' })).toBeInTheDocument();
    });
    unmount();
    const run = renderApp('/runs/00000000-0000-4000-8000-000000000001');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /^run /iu })).toBeInTheDocument();
    });
    run.unmount();
    renderApp('/evals/some-result');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Evaluation' })).toBeInTheDocument();
    });
  });

  it('says there is no page rather than showing an empty one', async () => {
    renderApp('/nonsense');
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('There is no page at');
    });
  });

  it('follows a link in the sidebar', async () => {
    renderApp('/');
    await userEvent.click(await screen.findByRole('link', { name: 'Ledger' }));
    await waitFor(() => {
      expect(globalThis.location.pathname).toBe('/ledger');
    });
    expect(screen.getByRole('heading', { name: 'Ledger' })).toBeInTheDocument();
  });

  it('marks the page you are on', async () => {
    renderApp('/tools');
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Tools' })).toHaveAttribute('aria-current', 'page');
    });
  });
});

describe('useApp', () => {
  it('refuses to work outside the application', () => {
    function Stray(): ReactNode {
      useApp();
      return null;
    }
    // React logs the thrown error; the test is that it throws at all.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Stray />)).toThrow(/outside the application/iu);
    quiet.mockRestore();
  });

  it('builds its own client when it is given none', async () => {
    // Whatever it asks for first, it gets an answer that says nobody is
    // signed in — which is enough to prove it built a client of its own.
    const answer = {
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"accounts":0,"oidc":false,"oidcLabel":null,"signedInAs":null}'),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(answer as Response)),
    );
    globalThis.history.replaceState({}, '', '/');
    render(<App />);
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });
    vi.unstubAllGlobals();
  });
});

describe('the database selector', () => {
  it('lists what the server offers and switches between them', async () => {
    const parts = vi.fn((_query: { source?: string }) =>
      Promise.resolve({ source: 'live', total: 0, offset: 0, limit: 50, items: [] }),
    );
    renderApp('/parts', {
      parts,
      sources: () =>
        Promise.resolve({
          sources: [
            {
              id: 'live',
              kind: 'live',
              label: 'Live store',
              exists: true,
              writable: true,
              bytes: 1,
              modifiedAt: '2026-09-12T00:00:00Z',
            },
            {
              id: 'dd212de6',
              kind: 'eval-run',
              label: 'Evaluation run dd212de6',
              exists: true,
              writable: false,
              bytes: 2,
              modifiedAt: '2026-09-12T00:00:00Z',
            },
          ],
        }),
    });
    // The list arrives after the sign-in state does, so what says the
    // selector is ready is an option in it.
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Evaluation run dd212de6' })).toBeInTheDocument();
    });
    await userEvent.selectOptions(screen.getByLabelText('Database'), 'dd212de6');
    await waitFor(() => {
      expect(parts.mock.calls.at(-1)?.[0]).toMatchObject({ source: 'dd212de6' });
    });
  });

  it('reads the database the address names, and remembers it', async () => {
    globalThis.localStorage.removeItem('chip:source');
    const parts = vi.fn((_query: { source?: string }) =>
      Promise.resolve({ source: 'dd212de6', total: 0, offset: 0, limit: 50, items: [] }),
    );
    renderApp('/parts?source=dd212de6', { parts });
    await waitFor(() => {
      expect(parts.mock.calls.at(-1)?.[0]).toMatchObject({ source: 'dd212de6' });
    });
    expect(globalThis.localStorage.getItem('chip:source')).toBe('dd212de6');
    globalThis.localStorage.removeItem('chip:source');
  });

  it('stores nothing again when the address names the database already in use', async () => {
    globalThis.localStorage.setItem('chip:source', 'dd212de6');
    const parts = vi.fn((_query: { source?: string }) =>
      Promise.resolve({ source: 'dd212de6', total: 0, offset: 0, limit: 50, items: [] }),
    );
    renderApp('/parts?source=dd212de6', { parts });
    await waitFor(() => {
      expect(parts.mock.calls.at(-1)?.[0]).toMatchObject({ source: 'dd212de6' });
    });
    expect(globalThis.localStorage.getItem('chip:source')).toBe('dd212de6');
    globalThis.localStorage.removeItem('chip:source');
  });

  it('says so when it cannot even list the databases', async () => {
    renderApp('/', { sources: () => Promise.reject(new Error('The data directory is gone')) });
    await waitFor(() => {
      expect(screen.getAllByRole('alert')[0]).toHaveTextContent('The data directory is gone');
    });
  });
});
