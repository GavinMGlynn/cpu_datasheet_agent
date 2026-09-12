// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../../../test/ui/render.js';
import { MAX_SCATTER_SERIES, Scatter, type ScatterPoint } from './Scatter.js';

const points: ScatterPoint[] = [
  { x: 3, y: 1.42, label: 'TPS54331DR', group: 'Texas Instruments' },
  { x: 2, y: 0.92, label: 'AP62200WU-7', group: 'Diodes Incorporated' },
  { x: 5, y: 2.1, label: 'LM76002RNPR', group: 'Texas Instruments' },
];

function scatter(rows: readonly ScatterPoint[] = points) {
  return renderAt(
    <Scatter
      title="price against current"
      caption="parts with no price are left out"
      points={rows}
      xLabel="output current"
      yLabel="each"
      formatX={(value) => `${String(value)} A`}
      formatY={(value) => `$${value.toFixed(2)}`}
    />,
  );
}

describe('Scatter', () => {
  it('plots the points and names the groups', () => {
    const { container } = scatter();
    expect(screen.getByRole('heading', { name: 'price against current' })).toBeInTheDocument();
    expect(screen.getByText('Texas Instruments')).toBeInTheDocument();
    expect(screen.getByText('Diodes Incorporated')).toBeInTheDocument();
    expect(container.querySelectorAll('.recharts-scatter').length).toBeGreaterThan(0);
  });

  it('gives the same numbers as a table', async () => {
    scatter();
    await userEvent.click(screen.getByRole('button', { name: 'show the numbers' }));
    expect(screen.getByRole('cell', { name: 'TPS54331DR' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '$1.42' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'output current' })).toBeInTheDocument();
  });

  it('folds a fourth group into "other" rather than inventing a colour', () => {
    scatter([
      ...points,
      { x: 1, y: 0.5, label: 'A', group: 'Infineon' },
      { x: 1, y: 0.6, label: 'B', group: 'Microchip' },
      { x: 1, y: 0.7, label: 'C', group: 'onsemi' },
    ]);
    expect(screen.getByText('other')).toBeInTheDocument();
    expect(MAX_SCATTER_SERIES).toBe(3);
  });

  it('plots points that belong to no group at all', () => {
    scatter([{ x: 1, y: 1, label: 'A' }]);
    // One series needs no legend: the title names it.
    expect(screen.queryByText('all')).toBeNull();
  });

  it('says when there is nothing to plot', () => {
    scatter([]);
    expect(screen.getByText('nothing to plot yet')).toBeInTheDocument();
  });

  it('takes a height of its own', () => {
    const { container } = renderAt(
      <Scatter
        title="price"
        points={points}
        xLabel="x"
        yLabel="y"
        formatX={String}
        formatY={String}
        height={200}
      />,
    );
    expect(container.querySelector('.chart-plot')).toHaveStyle({ height: '200px' });
  });
});
