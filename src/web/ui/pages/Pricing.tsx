import type { ReactNode } from 'react';
import { useState } from 'react';

import { useApp } from '../app.js';
import { Scatter } from '../charts/Scatter.js';
import { Async } from '../components/Async.js';
import { Page } from '../components/Page.js';
import { TextField } from '../components/Fields.js';
import { engineering, money } from '../lib/format.js';
import { navigate, withQuery } from '../lib/router.js';
import { useAsync } from '../lib/state.js';

/**
 * What the parts cost against what they do.
 *
 * Price on one axis, output current on the other: the plot a person reads
 * before asking for an alternate, because it shows which parts are dear for
 * what they deliver.
 */

function numberOf(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record: Record<string, unknown> = { ...value };
  const single = record.value;
  if (typeof single === 'number') {
    return single;
  }
  const top = record.max;
  return typeof top === 'number' ? top : undefined;
}

export function Pricing(): ReactNode {
  const { api, source, route } = useApp();
  const quantity = Number(route.query.get('quantity') ?? '100');
  // The field holds what was typed; the address holds what was asked for.
  // Without this, clearing the box would snap it back to the default
  // mid-keystroke.
  const [typed, setTyped] = useState(String(quantity));
  const parts = useAsync(`pricing:${source}:${String(quantity)}`, () =>
    api.parts({ source, quantity, limit: 500, sort: 'price' }),
  );

  return (
    <Page title="pricing" subtitle="what the stored parts cost, and for what">
      <div className="filters">
        <TextField
          label="price at quantity"
          type="number"
          value={typed}
          onChange={(value) => {
            setTyped(value);
            navigate(withQuery(route, { quantity: value === '' ? undefined : value }));
          }}
        />
      </div>
      <Async state={parts.state} label="the prices">
        {(page) => {
          const points = page.items
            .map((part) => {
              const iout = numberOf(part.headline.ioutMax);
              return part.bestPrice === null || iout === undefined
                ? undefined
                : {
                    x: iout,
                    y: part.bestPrice.amount,
                    label: part.mpn,
                    group: part.manufacturer,
                  };
            })
            .filter((point): point is NonNullable<typeof point> => point !== undefined);
          return (
            <>
              <Scatter
                title={`unit price at ${String(quantity)} against output current`}
                caption="parts with no price in this currency are left out rather than ranked"
                points={points}
                xLabel="output current"
                yLabel="each"
                formatX={(value) => engineering(value, 'A')}
                formatY={(value) => money(value)}
              />
              <div className="panel">
                <table>
                  <thead>
                    <tr>
                      <th>part</th>
                      <th>each</th>
                      <th>break</th>
                      <th>distributor</th>
                      <th className="numeric">stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.items
                      .filter((part) => part.bestPrice !== null)
                      .map((part) => (
                        <tr key={part.mpn}>
                          <td>{part.mpn}</td>
                          <td>{money(part.bestPrice?.amount, part.bestPrice?.currency)}</td>
                          <td>{part.bestPrice?.breakQuantity}</td>
                          <td>{part.bestPrice?.distributor}</td>
                          <td className="numeric">{part.stock}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          );
        }}
      </Async>
    </Page>
  );
}
