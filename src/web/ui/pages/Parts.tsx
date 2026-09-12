import type { ReactNode } from 'react';
import { useState } from 'react';

import { useApp } from '../app.js';
import { Async } from '../components/Async.js';
import { Badge } from '../components/Badge.js';
import { Page } from '../components/Page.js';
import { Time } from '../components/Time.js';
import { Select, TextField } from '../components/Fields.js';
import { Table } from '../components/Table.js';
import { count, money, parameterValue } from '../lib/format.js';
import { navigate, withQuery } from '../lib/router.js';
import { useAsync } from '../lib/state.js';
import type { PartSummary } from '../lib/types.js';

/**
 * Every stored part, filtered and sorted at the server.
 *
 * Sorting is server-side because the list pages: a table that sorted only the
 * page you can see would be lying about which part is cheapest.
 */

const SORTS = [
  { value: 'mpn', label: 'Part number' },
  { value: 'manufacturer', label: 'Manufacturer' },
  { value: 'status', label: 'Status' },
  { value: 'updatedAt', label: 'Last written' },
  { value: 'price', label: 'Unit price' },
  { value: 'stock', label: 'Stock' },
  { value: 'stated', label: 'Parameters found' },
  { value: 'verified', label: 'Parameters confirmed' },
];

const STATUSES = [
  { value: '', label: 'Any status' },
  { value: 'extracted', label: 'Extracted' },
  { value: 'verified', label: 'Verified' },
  { value: 'needs_human', label: 'Needs a person' },
  { value: 'rejected', label: 'Rejected' },
];

export function Parts(): ReactNode {
  const { api, source, route } = useApp();
  const text = route.query.get('text') ?? '';
  const status = route.query.get('status') ?? '';
  const sort = route.query.get('sort') ?? 'mpn';
  const direction = route.query.get('direction') ?? 'asc';
  const quantity = Number(route.query.get('quantity') ?? '100');
  const offset = Number(route.query.get('offset') ?? '0');
  const set = (changes: Readonly<Record<string, string | number | undefined>>): void => {
    navigate(withQuery(route, { offset: undefined, ...changes }));
  };
  // As on the pricing page: the field holds what was typed so that clearing
  // it does not snap back to the default between keystrokes.
  const [typedQuantity, setTypedQuantity] = useState(String(quantity));

  const parts = useAsync(
    `parts:${source}:${text}:${status}:${sort}:${direction}:${String(quantity)}:${String(offset)}`,
    () =>
      api.parts({
        source,
        sort,
        direction,
        quantity,
        offset,
        limit: 50,
        ...(text === '' ? {} : { text }),
        ...(status === '' ? {} : { status }),
      }),
  );

  return (
    <Page title="Catalogue" subtitle="Every part stored in this database">
      <div className="filters">
        <TextField
          label="Search"
          value={text}
          placeholder="Part number or manufacturer"
          onChange={(value) => {
            set({ text: value });
          }}
        />
        <Select
          label="Status"
          value={status}
          options={STATUSES}
          onChange={(value) => {
            set({ status: value });
          }}
        />
        <Select
          label="Sort by"
          value={sort}
          options={SORTS}
          onChange={(value) => {
            set({ sort: value });
          }}
        />
        <Select
          label="Direction"
          value={direction}
          options={[
            { value: 'asc', label: 'Ascending' },
            { value: 'desc', label: 'Descending' },
          ]}
          onChange={(value) => {
            set({ direction: value });
          }}
        />
        <TextField
          label="Price at quantity"
          type="number"
          value={typedQuantity}
          onChange={(value) => {
            setTypedQuantity(value);
            set({ quantity: value === '' ? undefined : value });
          }}
        />
      </div>
      <Async state={parts.state} label="the catalogue">
        {(page) => (
          <>
            <p className="caption">
              {count(page.total)} parts, showing {count(page.items.length)} from{' '}
              {count(page.offset + 1)}
            </p>
            <div className="panel">
              <Table<PartSummary>
                rows={page.items}
                rowKey={(part) => part.mpn}
                empty="Nothing matches those filters."
                columns={[
                  {
                    key: 'mpn',
                    label: 'Part',
                    render: (part) => (
                      <a
                        href={`/parts/${encodeURIComponent(part.mpn)}`}
                        onClick={(event) => {
                          event.preventDefault();
                          navigate(`/parts/${encodeURIComponent(part.mpn)}`);
                        }}
                      >
                        {part.mpn}
                      </a>
                    ),
                  },
                  {
                    key: 'manufacturer',
                    label: 'Manufacturer',
                    render: (part) => part.manufacturer,
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    render: (part) => <Badge kind="partStatus" value={part.status} />,
                  },
                  {
                    key: 'vin',
                    label: 'Vin',
                    render: (part) => (
                      <span className="nowrap">
                        {parameterValue(part.headline.vinMin)} –{' '}
                        {parameterValue(part.headline.vinMax)}
                      </span>
                    ),
                  },
                  {
                    key: 'iout',
                    label: 'Iout',
                    render: (part) => (
                      <span className="nowrap">{parameterValue(part.headline.ioutMax)}</span>
                    ),
                  },
                  {
                    key: 'package',
                    label: 'Package',
                    render: (part) => parameterValue(part.headline.package),
                  },
                  {
                    key: 'found',
                    label: 'Found',
                    numeric: true,
                    render: (part) =>
                      `${String(part.parameters.stated)}/${String(part.parameters.total)}`,
                  },
                  {
                    key: 'price',
                    label: 'Each',
                    numeric: true,
                    render: (part) =>
                      part.bestPrice === null
                        ? '—'
                        : money(part.bestPrice.amount, part.bestPrice.currency),
                  },
                  {
                    key: 'stock',
                    label: 'Stock',
                    numeric: true,
                    render: (part) => count(part.stock),
                  },
                  {
                    key: 'updated',
                    label: 'Updated',
                    render: (part) => <Time value={part.updatedAt} />,
                  },
                ]}
              />
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="secondary"
                disabled={page.offset === 0}
                onClick={() => {
                  navigate(withQuery(route, { offset: Math.max(0, page.offset - page.limit) }));
                }}
              >
                Previous
              </button>
              <button
                type="button"
                className="secondary"
                disabled={page.offset + page.limit >= page.total}
                onClick={() => {
                  navigate(withQuery(route, { offset: page.offset + page.limit }));
                }}
              >
                Next
              </button>
            </div>
          </>
        )}
      </Async>
    </Page>
  );
}
