// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../../../test/ui/render.js';
import { TimeSeries } from './TimeSeries.js';

const rows = [
  { key: '2026-09-11', costUsd: 7.68, cumulativeUsd: 7.68, runs: 2 },
  { key: '2026-09-12', costUsd: 0.45, cumulativeUsd: 8.13, runs: 1 },
];

describe('TimeSeries', () => {
  it('draws two lines on one axis, and names them', () => {
    const { container } = renderAt(<TimeSeries title="what it has cost" rows={rows} />);
    expect(screen.getByRole('heading', { name: 'what it has cost' })).toBeInTheDocument();
    expect(container.querySelectorAll('.recharts-line')).toHaveLength(2);
    expect(container.querySelectorAll('.yAxis')).toHaveLength(1);
    expect(screen.getByText('spent')).toBeInTheDocument();
    expect(screen.getByText('spent in total')).toBeInTheDocument();
  });

  it('gives the same numbers as a table', async () => {
    renderAt(<TimeSeries title="what it has cost" caption="model calls only" rows={rows} />);
    await userEvent.click(screen.getByRole('button', { name: 'show the numbers' }));
    expect(screen.getByRole('cell', { name: '2026-09-11' })).toBeInTheDocument();
    // The first day's spend and its running total are the same number, and
    // both cells are shown.
    expect(screen.getAllByRole('cell', { name: '$7.68' })).toHaveLength(2);
    expect(screen.getByRole('cell', { name: '$8.13' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '2' })).toBeInTheDocument();
  });

  it('says when there is nothing to plot', () => {
    renderAt(<TimeSeries title="what it has cost" rows={[]} />);
    expect(screen.getByText('no runs in this window')).toBeInTheDocument();
  });

  it('takes a height of its own', () => {
    const { container } = renderAt(<TimeSeries title="cost" rows={rows} height={180} />);
    expect(container.querySelector('.chart-plot')).toHaveStyle({ height: '180px' });
  });
});
