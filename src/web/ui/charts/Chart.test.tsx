// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../../../test/ui/render.js';
import { Chart } from './Chart.js';

interface Row {
  readonly label: string;
  readonly value: number;
}

const rows: Row[] = [
  { label: 'a', value: 1 },
  { label: 'b', value: 2 },
];

const columns = [
  { label: 'what', value: (row: Row) => row.label },
  { label: 'How much', value: (row: Row) => String(row.value) },
];

describe('Chart', () => {
  it('draws the plot, and says how wide it may be', () => {
    renderAt(
      <Chart title="Calls by tool" rows={rows} columns={columns}>
        {(width) => <p>plot at {width}</p>}
      </Chart>,
    );
    expect(screen.getByRole('heading', { name: 'Calls by tool' })).toBeInTheDocument();
    expect(screen.getByText(/plot at \d+/iu)).toBeInTheDocument();
  });

  it('offers the numbers behind it, and goes back again', async () => {
    renderAt(
      <Chart title="Calls by tool" caption="Busiest first" rows={rows} columns={columns}>
        {() => <p>The plot</p>}
      </Chart>,
    );
    expect(screen.getByText('Busiest first')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'show the numbers' }));
    expect(screen.getByRole('columnheader', { name: 'How much' })).toBeInTheDocument();
    expect(screen.queryByText('The plot')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'show the chart' }));
    expect(screen.getByText('The plot')).toBeInTheDocument();
  });

  it('shows a legend once there is more than one series', () => {
    const { rerender } = renderAt(
      <Chart
        title="spend"
        rows={rows}
        columns={columns}
        legend={[{ label: 'Spent', color: '#2a78d6' }]}
      >
        {() => <p>plot</p>}
      </Chart>,
    );
    expect(screen.queryByText('Spent')).toBeNull();
    rerender(
      <Chart
        title="spend"
        rows={rows}
        columns={columns}
        legend={[
          { label: 'Spent', color: '#2a78d6' },
          { label: 'In total', color: '#eb6834' },
        ]}
      >
        {() => <p>plot</p>}
      </Chart>,
    );
    expect(screen.getByText('Spent')).toBeInTheDocument();
    expect(screen.getByText('In total')).toBeInTheDocument();
  });

  it('says when there is nothing to draw, in its own words', () => {
    renderAt(
      <Chart title="spend" rows={[]} columns={columns} empty="No runs in this window.">
        {() => <p>plot</p>}
      </Chart>,
    );
    expect(screen.getByText('No runs in this window.')).toBeInTheDocument();
    expect(screen.queryByText('plot')).toBeNull();
  });

  it('has a default for nothing to draw', () => {
    renderAt(
      <Chart title="spend" rows={[]} columns={columns}>
        {() => <p>plot</p>}
      </Chart>,
    );
    expect(screen.getByText('nothing to show yet')).toBeInTheDocument();
  });

  it('takes a height of its own', () => {
    const { container } = renderAt(
      <Chart title="spend" rows={rows} columns={columns} height={400}>
        {() => <p>plot</p>}
      </Chart>,
    );
    expect(container.querySelector('.chart-plot')).toHaveStyle({ height: '400px' });
  });
});
