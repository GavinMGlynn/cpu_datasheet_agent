// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { PartQuery } from '../lib/api.js';
import { renderApp } from '../../../../test/ui/render.js';
import { summary } from '../../../../test/ui/fixtures.js';

function page(
  items = [summary(), summary({ mpn: 'AP62200WU-7', manufacturer: 'Diodes Incorporated' })],
) {
  return { source: 'live', total: items.length, offset: 0, limit: 500, items };
}

describe('pricing', () => {
  it('plots price against current and lists the prices', async () => {
    renderApp('/pricing', { parts: () => Promise.resolve(page()) });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /unit price at 100/u })).toBeInTheDocument();
    });
    expect(screen.getAllByText('AUD 1.42').length).toBeGreaterThan(0);
    expect(screen.getByText('Texas Instruments')).toBeInTheDocument();
  });

  it('prices at the quantity asked for', async () => {
    const parts = vi.fn((_query: PartQuery) => Promise.resolve(page()));
    renderApp('/pricing', { parts });
    await waitFor(() => {
      expect(parts.mock.calls[0]?.[0]).toMatchObject({ quantity: 100 });
    });
    // Clearing the field asks for the default rather than for nothing.
    await userEvent.clear(screen.getByLabelText('price at quantity'));
    await waitFor(() => {
      expect(parts.mock.calls.at(-1)?.[0]).toMatchObject({ quantity: 100 });
    });
    await userEvent.type(screen.getByLabelText('price at quantity'), '1000');
    await waitFor(() => {
      expect(parts.mock.calls.at(-1)?.[0]).toMatchObject({ quantity: 1000 });
    });
  });

  it('leaves out a part with no price, and one with no current', async () => {
    renderApp('/pricing', {
      parts: () =>
        Promise.resolve(
          page([
            summary({ bestPrice: null }),
            summary({ mpn: 'LM5164DDAR', headline: { ioutMax: null } }),
            summary({ mpn: 'TPS62130RGTR', headline: { ioutMax: { unit: 'A' } } }),
            summary({ mpn: 'AP63203WU-7', headline: { ioutMax: { unit: 'A', max: 2 } } }),
          ]),
        ),
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /unit price/u })).toBeInTheDocument();
    });
    // Only the part with both a price and a current is plotted; the table
    // still lists everything that has a price.
    expect(screen.getByRole('cell', { name: 'AP63203WU-7' })).toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: 'TPS54331DR' })).toBeNull();
  });

  it('says when there is nothing to plot at all', async () => {
    renderApp('/pricing', { parts: () => Promise.resolve(page([])) });
    await waitFor(() => {
      expect(screen.getByText('nothing to plot yet')).toBeInTheDocument();
    });
  });
});
