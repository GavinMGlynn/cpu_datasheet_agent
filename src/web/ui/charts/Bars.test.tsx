// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../../../test/ui/render.js';
import { Bars, barShape } from './Bars.js';

const rows = [
  { label: 'read_pages', value: 134, note: '0 failed' },
  { label: 'spend_gate', value: 1101 },
  { label: 'fetch_datasheet', value: 55 },
];

describe('Bars', () => {
  it('draws a bar per row, dearest first', () => {
    const { container } = renderAt(
      <Bars title="calls by tool" rows={rows} format={(value) => String(value)} />,
    );
    expect(screen.getByRole('heading', { name: 'calls by tool' })).toBeInTheDocument();
    expect(container.querySelectorAll('.recharts-bar-rectangle, rect')).not.toHaveLength(0);
  });

  it('gives the same numbers as a table, in the same order', async () => {
    renderAt(
      <Bars title="calls by tool" rows={rows} format={(value) => `${String(value)} calls`} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'show the numbers' }));
    const cells = screen.getAllByRole('cell').map((cell) => cell.textContent);
    expect(cells[0]).toBe('spend_gate');
    expect(cells[1]).toBe('1101 calls');
    expect(cells[2]).toBe('');
    expect(cells[3]).toBe('read_pages');
    expect(cells[5]).toBe('0 failed');
  });

  it('says when there is nothing to draw', () => {
    renderAt(<Bars title="calls" rows={[]} format={String} empty="nothing has been called" />);
    expect(screen.getByText('nothing has been called')).toBeInTheDocument();
  });

  it('takes a caption and a height of its own', () => {
    const { container } = renderAt(
      <Bars title="calls" caption="busiest first" rows={rows} format={String} height={300} />,
    );
    expect(screen.getByText('busiest first')).toBeInTheDocument();
    expect(container.querySelector('.chart-plot')).toHaveStyle({ height: '300px' });
  });
});

describe('emphasis', () => {
  it('highlights one row and greys the rest', () => {
    const { container } = renderAt(
      <Bars title="calls" rows={rows} format={String} highlight="read_pages" />,
    );
    const fills = [...container.querySelectorAll('rect')].map((rect) => rect.getAttribute('fill'));
    expect(fills).toContain('#2a78d6');
    expect(fills).toContain('#cdccc4');
  });

  it('draws a bar of zero where every row is zero', () => {
    const { container } = renderAt(
      <Bars title="calls" rows={[{ label: 'none', value: 0 }]} format={String} />,
    );
    expect(container.querySelector('rect')).not.toBeNull();
  });
});

describe('barShape', () => {
  const shape = barShape((value) => (value > 100 ? '#0d366b' : '#cde2fb'));

  it('draws a rectangle in the colour the value earns', () => {
    const drawn = shape({ x: 1, y: 2, width: 30, height: 10, value: 200 });
    expect(drawn).toMatchObject({ props: { fill: '#0d366b', width: 30, height: 10 } });
    expect(shape({ x: 1, y: 2, width: 30, height: 10, value: 1 })).toMatchObject({
      props: { fill: '#cde2fb' },
    });
  });

  it('never draws a negative rectangle', () => {
    expect(shape({ x: 0, y: 0, width: -5, height: -5, value: 1 })).toMatchObject({
      props: { width: 0, height: 0 },
    });
  });

  it('draws nothing where the library has not laid it out yet', () => {
    expect(shape({ value: 1 })).toMatchObject({ type: 'g' });
  });

  it('treats a value that is not a number as nothing', () => {
    expect(shape({ x: 0, y: 0, width: 1, height: 1, value: 'x' })).toMatchObject({
      props: { fill: '#cde2fb' },
    });
  });
});
