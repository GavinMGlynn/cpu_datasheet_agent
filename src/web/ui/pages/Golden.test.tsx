// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderApp } from '../../../../test/ui/render.js';

const parts = {
  parts: [
    {
      file: 'TPS54331DR.json',
      mpn: 'TPS54331DR',
      manufacturer: 'Texas Instruments',
      reason: 'the reference part: non-synchronous, integrated FET, adjustable',
      readBy: 'claude-opus-5',
      readAt: '2026-09-11T00:00:00Z',
      pageCount: 40,
    },
    {
      file: 'AP62200WU-7.json',
      mpn: 'AP62200WU-7',
      manufacturer: 'Diodes Incorporated',
      reason: 'a synchronous part with a fixed output',
      readBy: 'claude-opus-5',
      readAt: '2026-09-10T00:00:00Z',
      pageCount: 22,
    },
  ],
};

const healthy = { parts: 22, issues: [], coverage: { vinMax: 22 }, thin: [] };

describe('the golden set', () => {
  it('lists the parts and who read them', async () => {
    renderApp('/golden', {
      golden: () => Promise.resolve(parts),
      goldenHealth: () => Promise.resolve(healthy),
    });
    await waitFor(() => {
      expect(screen.getByRole('cell', { name: 'TPS54331DR' })).toBeInTheDocument();
    });
    expect(screen.getAllByText('claude-opus-5')).toHaveLength(2);
    expect(screen.getByText('clean')).toBeInTheDocument();
    expect(screen.getByText('none')).toBeInTheDocument();
  });

  it('reports the health checks when the set has problems', async () => {
    renderApp('/golden', {
      golden: () => Promise.resolve(parts),
      goldenHealth: () =>
        Promise.resolve({
          parts: 1,
          issues: [{ kind: 'thin-coverage', detail: 'vinMax has one example' }],
          coverage: { vinMax: 1 },
          thin: ['vinMax', 'ioutMax'],
        }),
    });
    await waitFor(() => {
      expect(screen.getByText('vinMax has one example')).toBeInTheDocument();
    });
    expect(screen.getByText('1 issues')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('sorts by when each part was read', async () => {
    renderApp('/golden', {
      golden: () => Promise.resolve(parts),
      goldenHealth: () => Promise.resolve(healthy),
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'sort by read' })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: 'sort by read' }));
    expect(screen.getByRole('cell', { name: '2026-09-11 00:00' })).toBeInTheDocument();
  });
});
