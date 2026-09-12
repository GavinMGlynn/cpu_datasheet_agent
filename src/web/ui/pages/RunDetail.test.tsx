// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderApp } from '../../../../test/ui/render.js';
import { run } from '../../../../test/ui/fixtures.js';
import type { ToolCall } from '../lib/types.js';

const parent: ToolCall = {
  id: '00000000-0000-4000-8000-000000000010',
  sessionId: 'session-a',
  tool: 'fetch_offers',
  input: { mpn: 'TPS54331DR' },
  output: { offers: 1 },
  startedAt: '2026-09-11T09:00:05Z',
  durationMs: 2100,
  spendsQuota: true,
};

const child: ToolCall = {
  id: '00000000-0000-4000-8000-000000000011',
  sessionId: 'session-a',
  parentId: parent.id,
  tool: 'spend_gate',
  input: { tool: 'fetch_offers' },
  output: { decision: 'allow' },
  startedAt: '2026-09-11T09:00:06Z',
  durationMs: 1,
  spendsQuota: false,
};

const failed: ToolCall = {
  id: '00000000-0000-4000-8000-000000000012',
  sessionId: 'session-a',
  tool: 'Read_pages',
  input: { pages: [4] },
  error: { name: 'CacheMissError', code: 'CACHE_MISS', message: 'Not cached' },
  startedAt: '2026-09-11T09:00:07Z',
  durationMs: 4,
  spendsQuota: false,
};

function detail(overrides: Record<string, unknown> = {}) {
  return {
    run: run({
      details: {
        toolCalls: 3,
        toolFailures: ['Read_pages'],
        escalations: 1,
        spendDenials: 2,
        cacheMisses: 3,
        stored: true,
        subtype: 'success',
      },
    }),
    calls: [parent, child, failed],
    tree: [
      { record: parent, children: [{ record: child, children: [] }] },
      { record: failed, children: [] },
    ],
    ...overrides,
  };
}

describe('one run', () => {
  it('says what it cost and what it did', async () => {
    renderApp('/runs/00000000-0000-4000-8000-000000000001', {
      run: () => Promise.resolve(detail()),
    });
    // The heading is drawn from the address, so it is there before the run
    // is: what says the page has loaded is the run's own numbers.
    await waitFor(() => {
      expect(screen.getByText('$3.41')).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: /run 00000000/iu })).toBeInTheDocument();
    expect(screen.getByText('4m 0s')).toBeInTheDocument();
    expect(screen.getByText('claude-opus-5')).toBeInTheDocument();
    expect(screen.getByText('2 calls the money gate refused')).toBeInTheDocument();
    expect(screen.getByText('3 wanted something uncached')).toBeInTheDocument();
  });

  it('nests a gate decision under the call it gated', async () => {
    renderApp('/runs/00000000-0000-4000-8000-000000000001', {
      run: () => Promise.resolve(detail()),
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'fetch_offers' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'spend_gate' })).toBeInTheDocument();
    expect(screen.getByText(/may spend/iu)).toBeInTheDocument();
    expect(screen.getByText(/CACHE_MISS/iu)).toBeInTheDocument();
  });

  it('shows what a call sent and what came back', async () => {
    renderApp('/runs/00000000-0000-4000-8000-000000000001', {
      run: () => Promise.resolve(detail()),
    });
    await waitFor(() => {
      expect(screen.getByText('Pick a call')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: 'fetch_offers' }));
    expect(screen.getByLabelText('What went in')).toHaveTextContent('TPS54331DR');
    expect(screen.getByText('What came back')).toBeInTheDocument();
  });

  it('shows why a call failed', async () => {
    renderApp('/runs/00000000-0000-4000-8000-000000000001', {
      run: () => Promise.resolve(detail()),
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Read_pages' })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Read_pages' }));
    expect(screen.getByText('What went wrong')).toBeInTheDocument();
    expect(screen.getByLabelText('What came back')).toHaveTextContent('CACHE_MISS');
  });

  it('says when a run left no trace in the ledger', async () => {
    renderApp('/runs/00000000-0000-4000-8000-000000000001', {
      run: () => Promise.resolve(detail({ calls: [], tree: [] })),
    });
    await waitFor(() => {
      expect(screen.getByText(/this run left no trace in the ledger/iu)).toBeInTheDocument();
    });
  });

  it('copes with a run that never finished and recorded no detail', async () => {
    renderApp('/runs/00000000-0000-4000-8000-000000000009', {
      run: () =>
        Promise.resolve({
          run: {
            id: '00000000-0000-4000-8000-000000000009',
            mpn: 'LM5164DDAR',
            kind: 'extract',
            promptVersion: 'extract.v1',
            model: 'claude-opus-5',
            startedAt: '2026-09-13T00:00:00Z',
          },
          calls: [],
          tree: [],
        }),
    });
    await waitFor(() => {
      // Once as the headline, once as the badge beside the model.
      expect(screen.getAllByText('Unfinished')).toHaveLength(2);
    });
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('goes back to the runs', async () => {
    renderApp('/runs/00000000-0000-4000-8000-000000000001', {
      run: () => Promise.resolve(detail()),
      runs: () => Promise.resolve({ total: 0, offset: 0, limit: 500, items: [] }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Back to runs' }));
    await waitFor(() => {
      expect(globalThis.location.pathname).toBe('/runs');
    });
  });
});
