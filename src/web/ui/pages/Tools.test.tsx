// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderApp } from '../../../../test/ui/render.js';

const tools = {
  tools: [
    {
      tool: 'spend_gate',
      calls: 1101,
      failures: 0,
      failureRate: 0,
      spending: 0,
      duration: { count: 1101, sum: 0, min: 0, max: 1, mean: 0, p50: 0, p90: 0, p99: 1 },
      totalMs: 220,
      errors: {},
    },
    {
      tool: 'normalise_value',
      calls: 94,
      failures: 9,
      failureRate: 0.0957,
      spending: 0,
      duration: { count: 94, sum: 94, min: 0, max: 4, mean: 1, p50: 1, p90: 3, p99: 4 },
      totalMs: 94,
      errors: { UNIT_PARSE_FAILED: 9 },
    },
  ],
};

const errors = {
  errors: [
    {
      code: 'UNIT_PARSE_FAILED',
      count: 9,
      tools: ['normalise_value'],
      latestAt: '2026-09-11T12:00:00Z',
      message: 'cannot parse "3 V to 32 V"',
    },
    {
      code: 'CACHE_MISS',
      count: 7,
      tools: ['digikey_keyword_search', 'digikey_product_details'],
      latestAt: '2026-09-11T11:00:00Z',
      message: 'no cached entry, and this call may not fetch',
    },
  ],
};

describe('tools', () => {
  it('counts the calls, the failures and the timings', async () => {
    renderApp('/tools', {
      tools: () => Promise.resolve(tools),
      errors: () => Promise.resolve(errors),
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'calls by tool' })).toBeInTheDocument();
    });
    expect(screen.getByRole('cell', { name: '1,101' })).toBeInTheDocument();
    expect(screen.getByText('9 (10%)')).toBeInTheDocument();
    // A tool that has never failed shows a dash rather than a zero.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('lists what has failed, and from where', async () => {
    renderApp('/tools', {
      tools: () => Promise.resolve(tools),
      errors: () => Promise.resolve(errors),
    });
    await waitFor(() => {
      expect(screen.getByText('UNIT_PARSE_FAILED')).toBeInTheDocument();
    });
    expect(screen.getByText('cannot parse "3 V to 32 V"')).toBeInTheDocument();
  });

  it('sorts the table', async () => {
    renderApp('/tools', {
      tools: () => Promise.resolve(tools),
      errors: () => Promise.resolve(errors),
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'sort by median' })).toBeInTheDocument();
    });
    for (const column of ['tool', 'calls', 'failed', 'may spend', 'median', '90th', 'total time']) {
      await userEvent.click(screen.getByRole('button', { name: `sort by ${column}` }));
    }
    await userEvent.click(screen.getByRole('button', { name: 'sort by times' }));
    expect(screen.getAllByRole('table').length).toBe(2);
  });

  it('says when nothing has failed', async () => {
    renderApp('/tools', {
      tools: () => Promise.resolve(tools),
      errors: () => Promise.resolve({ errors: [] }),
    });
    await waitFor(() => {
      expect(screen.getByText('nothing has failed in this ledger')).toBeInTheDocument();
    });
  });
});
