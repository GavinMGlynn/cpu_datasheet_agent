// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { LedgerQuery } from '../lib/api.js';
import type { ToolCall } from '../lib/types.js';
import { renderApp } from '../../../../test/ui/render.js';

const ok: ToolCall = {
  id: '00000000-0000-4000-8000-000000000010',
  sessionId: 'session-a',
  tool: 'resolve_mpn',
  input: { mpn: 'TPS54331DR' },
  output: { matched: 1 },
  startedAt: '2026-09-11T09:00:00Z',
  durationMs: 13,
  spendsQuota: false,
};

const failed: ToolCall = {
  ...ok,
  id: '00000000-0000-4000-8000-000000000011',
  tool: 'read_pages',
  output: undefined,
  error: { name: 'CacheMissError', code: 'CACHE_MISS', message: 'not cached' },
};

function page(items: ToolCall[] = [ok, failed], total = items.length, offset = 0) {
  return { total, offset, limit: 50, items };
}

describe('the ledger', () => {
  it('lists the calls with what they did and how long they took', async () => {
    renderApp('/ledger', { ledger: () => Promise.resolve(page()) });
    await waitFor(() => {
      expect(screen.getByText('2 calls match; showing 2')).toBeInTheDocument();
    });
    expect(screen.getAllByText('13 ms')).toHaveLength(2);
    expect(screen.getByText('ok')).toBeInTheDocument();
    expect(screen.getByText('CACHE_MISS')).toBeInTheDocument();
  });

  it('filters by text, by tool, and by failure', async () => {
    const ledger = vi.fn((_query: LedgerQuery) => Promise.resolve(page()));
    renderApp('/ledger', { ledger });
    await waitFor(() => {
      expect(ledger).toHaveBeenCalledTimes(1);
    });
    await userEvent.type(screen.getByLabelText('search the tool and its input'), 'TPS');
    await waitFor(() => {
      expect(ledger.mock.calls.at(-1)?.[0]).toMatchObject({ text: 'TPS' });
    });
    await userEvent.type(screen.getByLabelText('one tool'), 'read_pages');
    await waitFor(() => {
      expect(ledger.mock.calls.at(-1)?.[0]).toMatchObject({ tool: 'read_pages' });
    });
    await userEvent.click(screen.getByLabelText('only the ones that failed'));
    await waitFor(() => {
      expect(ledger.mock.calls.at(-1)?.[0]).toMatchObject({ failed: true });
    });
    await userEvent.click(screen.getByLabelText('only the ones that failed'));
    await waitFor(() => {
      expect(ledger.mock.calls.at(-1)?.[0]).not.toHaveProperty('failed');
    });
  });

  it('shows one call in full, and what went wrong with another', async () => {
    renderApp('/ledger', { ledger: () => Promise.resolve(page()) });
    await waitFor(() => {
      expect(screen.getByText('pick a call')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: 'resolve_mpn' }));
    expect(screen.getByLabelText('what went in')).toHaveTextContent('TPS54331DR');
    expect(screen.getByText('what came back')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'read_pages' }));
    expect(screen.getByText('what went wrong')).toBeInTheDocument();
  });

  it('pages through the calls', async () => {
    const ledger = vi.fn((_query: LedgerQuery) => Promise.resolve(page([ok], 120, 0)));
    renderApp('/ledger', { ledger });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'next' })).toBeEnabled();
    });
    expect(screen.getByRole('button', { name: 'previous' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'next' }));
    await waitFor(() => {
      expect(ledger.mock.calls.at(-1)?.[0]).toMatchObject({ offset: 50 });
    });
  });

  it('pages back', async () => {
    const ledger = vi.fn((_query: LedgerQuery) => Promise.resolve(page([ok], 120, 50)));
    renderApp('/ledger?offset=50', { ledger });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'previous' })).toBeEnabled();
    });
    await userEvent.click(screen.getByRole('button', { name: 'previous' }));
    await waitFor(() => {
      expect(ledger.mock.calls.at(-1)?.[0]).toMatchObject({ offset: 0 });
    });
  });

  it('says when nothing matches', async () => {
    renderApp('/ledger', { ledger: () => Promise.resolve(page([], 0)) });
    await waitFor(() => {
      expect(screen.getByText('nothing matches')).toBeInTheDocument();
    });
  });
});
