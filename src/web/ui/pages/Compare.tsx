import type { ReactNode } from 'react';

import { useApp } from '../app.js';
import { Async } from '../components/Async.js';
import { Page } from '../components/Page.js';
import { TextField } from '../components/Fields.js';
import { parameterValue } from '../lib/format.js';
import { navigate, withQuery } from '../lib/router.js';
import { useAsync } from '../lib/state.js';

/**
 * Any number of parts side by side, with the differences called out.
 *
 * A row where every part agrees is dimmed rather than hidden: "they all say
 * the same thing" is an answer, and hiding it would make the table look like
 * the parts differ more than they do.
 */

export function Compare(): ReactNode {
  const { api, source, route } = useApp();
  const raw = route.query.get('mpns') ?? '';
  const mpns = raw
    .split(',')
    .map((one) => one.trim())
    .filter((one) => one !== '');
  const compare = useAsync(`compare:${source}:${mpns.join(',')}`, () =>
    mpns.length === 0 ? Promise.resolve({ parts: [], keys: [] }) : api.compare(mpns, source),
  );

  return (
    <Page title="Compare" subtitle="Two or more parts, parameter by parameter">
      <div className="filters">
        <TextField
          label="Part numbers, comma separated"
          value={raw}
          placeholder="TPS54331DR, AP62200WU-7"
          onChange={(value) => {
            navigate(withQuery(route, { mpns: value }));
          }}
        />
      </div>
      <Async state={compare.state} label="the comparison">
        {(value) =>
          value.parts.length === 0 ? (
            <p className="empty">Name some parts above and they will appear here side by side.</p>
          ) : (
            <div className="panel" style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Parameter</th>
                    {value.parts.map((part) => (
                      <th key={part.summary.mpn}>{part.summary.mpn}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {value.keys.map((key) => {
                    const cells = value.parts.map(
                      (part) => part.parameters.find((row) => row.key === key)?.value,
                    );
                    const rendered = cells.map((cell) => parameterValue(cell));
                    const same = rendered.every((one) => one === rendered[0]);
                    return (
                      <tr key={key} style={same ? { color: 'var(--ink-3)' } : undefined}>
                        <td>{key}</td>
                        {rendered.map((cell, index) => (
                          <td key={`${key}-${String(index)}`}>
                            {same ? cell : <strong>{cell}</strong>}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        }
      </Async>
    </Page>
  );
}
