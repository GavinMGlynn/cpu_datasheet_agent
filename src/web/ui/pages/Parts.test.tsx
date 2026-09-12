// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { PartQuery } from '../lib/api.js';
import { renderApp } from '../../../../test/ui/render.js';
import { summary } from '../../../../test/ui/fixtures.js';

function page(items = [summary(), summary({ mpn: 'AP62200WU-7', status: 'verified' })]) {
  return { source: 'live', total: items.length, offset: 0, limit: 50, items };
}

describe('the catalogue', () => {
  it('lists what the server sent', async () => {
    renderApp('/parts', { parts: () => Promise.resolve(page()) });
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'TPS54331DR' })).toBeInTheDocument();
    });
    expect(screen.getByText('2 parts, showing 2 from 1')).toBeInTheDocument();
    // Both seeded parts have the same headline values, so both rows show them.
    expect(screen.getAllByText('3.5 V – 28 V')).toHaveLength(2);
    expect(screen.getAllByText('SOIC-8')).toHaveLength(2);
    expect(screen.getAllByText('AUD 1.42')).toHaveLength(2);
    expect(screen.getAllByText('12,000')).toHaveLength(2);
  });

  it('asks the server again when a filter changes', async () => {
    const parts = vi.fn((_query: PartQuery) => Promise.resolve(page()));
    renderApp('/parts', { parts });
    await waitFor(() => {
      expect(parts).toHaveBeenCalledTimes(1);
    });
    await userEvent.type(screen.getByLabelText('Search'), 'AP');
    await waitFor(() => {
      expect(parts.mock.calls.at(-1)?.[0]).toMatchObject({ text: 'AP' });
    });
  });

  it('passes every filter to the server', async () => {
    const parts = vi.fn((_query: PartQuery) => Promise.resolve(page()));
    renderApp('/parts?status=verified&sort=price&direction=desc&quantity=500', { parts });
    await waitFor(() => {
      expect(parts.mock.calls[0]?.[0]).toMatchObject({
        status: 'verified',
        sort: 'price',
        direction: 'desc',
        quantity: 500,
      });
    });
  });

  it('changes a filter through the controls', async () => {
    const parts = vi.fn((_query: PartQuery) => Promise.resolve(page()));
    renderApp('/parts', { parts });
    await waitFor(() => {
      expect(screen.getByLabelText('Status')).toBeInTheDocument();
    });
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'Verified');
    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'price');
    await userEvent.selectOptions(screen.getByLabelText('Direction'), 'desc');
    await userEvent.clear(screen.getByLabelText('Price at quantity'));
    await userEvent.type(screen.getByLabelText('Price at quantity'), '250');
    await waitFor(() => {
      expect(parts.mock.calls.at(-1)?.[0]).toMatchObject({ direction: 'desc', quantity: 250 });
    });
  });

  it('pages forwards and back', async () => {
    const parts = vi.fn((_query: PartQuery) =>
      Promise.resolve({ source: 'live', total: 120, offset: 0, limit: 50, items: [summary()] }),
    );
    renderApp('/parts', { parts });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    });
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(parts.mock.calls.at(-1)?.[0]).toMatchObject({ offset: 50 });
    });
  });

  it('pages back from where it is', async () => {
    const parts = vi.fn((_query: PartQuery) =>
      Promise.resolve({ source: 'live', total: 120, offset: 50, limit: 50, items: [summary()] }),
    );
    renderApp('/parts?offset=50', { parts });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => {
      expect(parts.mock.calls.at(-1)?.[0]).toMatchObject({ offset: 0 });
    });
  });

  it('opens a part', async () => {
    renderApp('/parts', {
      parts: () => Promise.resolve(page()),
      part: () =>
        Promise.resolve({
          part: {},
          summary: summary(),
          parameters: [],
          runs: [],
          escalations: [],
          datasheetMpns: [],
        }),
    });
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'TPS54331DR' })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('link', { name: 'TPS54331DR' }));
    await waitFor(() => {
      expect(globalThis.location.pathname).toBe('/parts/TPS54331DR');
    });
  });

  it('says when a part has no price at all', async () => {
    renderApp('/parts', {
      parts: () => Promise.resolve(page([summary({ bestPrice: null })])),
    });
    await waitFor(() => {
      expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });
  });

  it('says when nothing matches', async () => {
    renderApp('/parts', { parts: () => Promise.resolve(page([])) });
    await waitFor(() => {
      expect(screen.getByText('Nothing matches those filters.')).toBeInTheDocument();
    });
  });
});
