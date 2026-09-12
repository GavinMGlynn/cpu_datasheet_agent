// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderApp } from '../../../../test/ui/render.js';
import { summary } from '../../../../test/ui/fixtures.js';

const items = [
  summary({ verdicts: { confirmed: 28, contradicted: 1, notFound: 1, unchecked: 0 } }),
  summary({
    mpn: 'AP62200WU-7',
    status: 'verified',
    verdicts: { confirmed: 30, contradicted: 0, notFound: 0, unchecked: 0 },
  }),
];

describe('verification', () => {
  it('counts the verdicts across the set', async () => {
    renderApp('/verification', {
      parts: () => Promise.resolve({ source: 'live', total: 2, offset: 0, limit: 500, items }),
    });
    await waitFor(() => {
      expect(screen.getByText('58')).toBeInTheDocument();
    });
    expect(screen.getByRole('img', { name: 'Verdicts by part' })).toBeInTheDocument();
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
  });

  it('sorts the parts by any verdict', async () => {
    renderApp('/verification', {
      parts: () => Promise.resolve({ source: 'live', total: 2, offset: 0, limit: 500, items }),
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sort by confirmed' })).toBeInTheDocument();
    });
    for (const column of ['confirmed', 'contradicted', 'not found', 'unchecked']) {
      await userEvent.click(screen.getByRole('button', { name: `Sort by ${column}` }));
    }
    expect(screen.getAllByRole('link').length).toBeGreaterThan(0);
  });

  it('opens a part from the table', async () => {
    renderApp('/verification', {
      parts: () => Promise.resolve({ source: 'live', total: 2, offset: 0, limit: 500, items }),
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

  it('copes with an empty database', async () => {
    renderApp('/verification', {
      parts: () => Promise.resolve({ source: 'live', total: 0, offset: 0, limit: 500, items: [] }),
    });
    await waitFor(() => {
      expect(screen.getByText('Nothing stored yet')).toBeInTheDocument();
    });
  });
});
