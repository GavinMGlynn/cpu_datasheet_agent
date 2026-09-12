// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../../../test/ui/render.js';
import { Histogram, bucketShape } from './Histogram.js';

const buckets = [
  { from: 0, to: 10, count: 3 },
  { from: 10, to: 20, count: 7 },
  { from: 20, to: 30, count: 0 },
];

describe('Histogram', () => {
  it('draws a bucket per band and labels the axis', () => {
    const { container } = renderAt(
      <Histogram
        title="VinMax across the set"
        buckets={buckets}
        format={(value) => `${String(value)} V`}
      />,
    );
    expect(screen.getByRole('heading', { name: 'VinMax across the set' })).toBeInTheDocument();
    expect(container.querySelectorAll('rect').length).toBeGreaterThan(0);
  });

  it('gives the same numbers as a table', async () => {
    renderAt(
      <Histogram
        title="vinMax"
        caption="22 parts state a number"
        buckets={buckets}
        format={(value) => `${String(value)} V`}
      />,
    );
    expect(screen.getByText('22 parts state a number')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'show the numbers' }));
    // 10 is both the end of the first band and the start of the second.
    expect(screen.getAllByRole('cell', { name: '10 V' })).toHaveLength(2);
    expect(screen.getByRole('cell', { name: '7' })).toBeInTheDocument();
  });

  it('says when there is nothing to plot', () => {
    renderAt(<Histogram title="vinMax" buckets={[]} format={String} empty="No numbers here" />);
    expect(screen.getByText('No numbers here')).toBeInTheDocument();
  });

  it('copes with buckets that are all empty', () => {
    const { container } = renderAt(
      <Histogram
        title="vinMax"
        buckets={[{ from: 0, to: 1, count: 0 }]}
        format={String}
        height={100}
      />,
    );
    expect(container.querySelector('.chart-plot')).toHaveStyle({ height: '100px' });
  });
});

describe('bucketShape', () => {
  it('colours a bucket by how full it is', () => {
    const shape = bucketShape((count) => (count > 5 ? '#0d366b' : '#cde2fb'));
    expect(shape({ x: 0, y: 0, width: 10, height: 10, value: 7 })).toMatchObject({
      props: { fill: '#0d366b' },
    });
    expect(shape({ value: 7 })).toMatchObject({ type: 'g' });
    expect(shape({ x: 0, y: 0, width: 1, height: 1, value: undefined })).toMatchObject({
      props: { fill: '#cde2fb' },
    });
  });
});
