// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../../../test/ui/render.js';
import { Table } from './Table.js';

interface Row {
  readonly mpn: string;
  readonly cost: number | undefined;
}

const rows: Row[] = [
  { mpn: 'TPS54331DR', cost: 3.41 },
  { mpn: 'AP62200WU-7', cost: 4.27 },
  { mpn: 'LM5164DDAR', cost: undefined },
];

function columns() {
  return [
    { key: 'mpn', label: 'part', render: (row: Row) => row.mpn, sort: (row: Row) => row.mpn },
    {
      key: 'cost',
      label: 'cost',
      numeric: true,
      render: (row: Row) => row.cost ?? '—',
      sort: (row: Row) => row.cost,
    },
    { key: 'note', label: 'note', render: () => 'fixed' },
  ];
}

/** The first cell of each body row, which is the part number. */
function order(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.querySelector('td')?.textContent ?? '');
}

describe('Table', () => {
  it('renders the rows it is given', () => {
    renderAt(<Table columns={columns()} rows={rows} rowKey={(row) => row.mpn} />);
    expect(screen.getAllByRole('row')).toHaveLength(4);
    expect(screen.getAllByText('fixed')).toHaveLength(3);
  });

  it('sorts when a heading is clicked, and again the other way', async () => {
    renderAt(<Table columns={columns()} rows={rows} rowKey={(row) => row.mpn} />);
    await userEvent.click(screen.getByRole('button', { name: 'sort by part' }));
    expect(order()[0]).toBe('AP62200WU-7');
    await userEvent.click(screen.getByRole('button', { name: 'sort by part' }));
    expect(order()[0]).toBe('TPS54331DR');
    await userEvent.click(screen.getByRole('button', { name: 'sort by part' }));
    expect(order()[0]).toBe('AP62200WU-7');
  });

  it('sorts numbers as numbers, and puts what it does not know last', async () => {
    renderAt(<Table columns={columns()} rows={rows} rowKey={(row) => row.mpn} />);
    await userEvent.click(screen.getByRole('button', { name: 'sort by cost' }));
    expect(order()[0]).toBe('TPS54331DR');
    expect(order()[2]).toBe('LM5164DDAR');
  });

  it('switches the column it sorts on', async () => {
    renderAt(
      <Table columns={columns()} rows={rows} rowKey={(row) => row.mpn} initialSort="cost" />,
    );
    expect(order()[0]).toBe('TPS54331DR');
    await userEvent.click(screen.getByRole('button', { name: 'sort by part' }));
    expect(order()[0]).toBe('AP62200WU-7');
  });

  it('starts sorted where it is told', () => {
    renderAt(
      <Table
        columns={columns()}
        rows={rows}
        rowKey={(row) => row.mpn}
        initialSort="cost"
        initialDirection="desc"
      />,
    );
    expect(order()[0]).toBe('AP62200WU-7');
  });

  it('leaves the rows alone when the column cannot be sorted', () => {
    renderAt(
      <Table columns={columns()} rows={rows} rowKey={(row) => row.mpn} initialSort="note" />,
    );
    expect(order()[0]).toBe('TPS54331DR');
  });

  it('says when there is nothing to show', () => {
    renderAt(
      <Table columns={columns()} rows={[]} rowKey={(row: Row) => row.mpn} empty="no runs yet" />,
    );
    expect(screen.getByText('no runs yet')).toBeInTheDocument();
  });

  it('has a default for nothing to show', () => {
    renderAt(<Table columns={columns()} rows={[]} rowKey={(row: Row) => row.mpn} />);
    expect(screen.getByText('nothing here')).toBeInTheDocument();
  });

  it('keeps two rows with equal values in the order they arrived', async () => {
    const tied: Row[] = [
      { mpn: 'A', cost: 1 },
      { mpn: 'B', cost: 1 },
    ];
    renderAt(<Table columns={columns()} rows={tied} rowKey={(row) => row.mpn} />);
    await userEvent.click(screen.getByRole('button', { name: 'sort by cost' }));
    expect(order()[0]).toBe('A');
  });

  it('puts an unknown last whichever side of the comparison it turns up on', async () => {
    const unknownFirst: Row[] = [
      { mpn: 'LM5164DDAR', cost: undefined },
      { mpn: 'TPS54331DR', cost: 3.41 },
      { mpn: 'AP62200WU-7', cost: 4.27 },
    ];
    renderAt(<Table columns={columns()} rows={unknownFirst} rowKey={(row) => row.mpn} />);
    await userEvent.click(screen.getByRole('button', { name: 'sort by cost' }));
    expect(order()).toStrictEqual(['TPS54331DR', 'AP62200WU-7', 'LM5164DDAR']);
  });

  it('leaves rows it knows nothing about in the order they arrived', async () => {
    const unknowns: Row[] = [
      { mpn: 'C', cost: undefined },
      { mpn: 'A', cost: undefined },
      { mpn: 'B', cost: undefined },
    ];
    renderAt(<Table columns={columns()} rows={unknowns} rowKey={(row) => row.mpn} />);
    await userEvent.click(screen.getByRole('button', { name: 'sort by cost' }));
    expect(order()).toStrictEqual(['C', 'A', 'B']);
  });
});
