// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderApp } from '../../../../test/ui/render.js';

const spend = {
  points: [
    { key: '2026-09-11', costUsd: 87.24, cumulativeUsd: 87.24, runs: 22, turns: 355 },
    { key: '2026-09-12', costUsd: 22.09, cumulativeUsd: 109.33, runs: 19, turns: 626 },
  ],
};

const breakdown = {
  breakdown: [
    {
      key: 'claude-opus-5',
      runs: 41,
      costUsd: 109.33,
      turns: 981,
      meanCostUsd: 2.67,
      unsuccessful: 14,
    },
  ],
};

describe('cost', () => {
  it('plots spending and breaks it down', async () => {
    renderApp('/costs', {
      spend: () => Promise.resolve(spend),
      spendBy: () => Promise.resolve(breakdown),
    });
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'spent, and spent in total' }),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: /spend by model/u })).toBeInTheDocument();
    expect(screen.getAllByText('$109.33').length).toBeGreaterThan(0);
    // The runs behind a total are in the table under the chart.
    await userEvent.click(
      screen.getAllByRole('button', { name: 'show the numbers' })[1] ?? new HTMLElement(),
    );
    expect(screen.getByText(/41 runs, \$2.67 each, 14 without a part/u)).toBeInTheDocument();
  });

  it('changes the granularity and the dimension', async () => {
    const spendBy = vi.fn((_dimension: string) => Promise.resolve(breakdown));
    const spendOver = vi.fn((_source: string, _granularity: string) => Promise.resolve(spend));
    renderApp('/costs', { spend: spendOver, spendBy });
    await waitFor(() => {
      expect(spendOver.mock.calls[0]?.[1]).toBe('day');
    });
    await userEvent.selectOptions(screen.getByLabelText('over'), 'month');
    await waitFor(() => {
      expect(spendOver.mock.calls.at(-1)?.[1]).toBe('month');
    });
    await userEvent.selectOptions(screen.getByLabelText('broken down'), 'promptVersion');
    await waitFor(() => {
      expect(spendBy.mock.calls.at(-1)?.[0]).toBe('promptVersion');
    });
  });

  it('says when nothing has been spent', async () => {
    renderApp('/costs', {
      spend: () => Promise.resolve({ points: [] }),
      spendBy: () => Promise.resolve({ breakdown: [] }),
    });
    await waitFor(() => {
      expect(screen.getByText('nothing has been spent in this database')).toBeInTheDocument();
    });
  });

  it('labels a dimension it has no phrase for', async () => {
    renderApp('/costs?dimension=invented', {
      spend: () => Promise.resolve(spend),
      spendBy: () => Promise.resolve(breakdown),
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'spend' })).toBeInTheDocument();
    });
  });
});
