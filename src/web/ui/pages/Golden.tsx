import type { ReactNode } from 'react';

import { useApp } from '../app.js';
import { Async } from '../components/Async.js';
import { Page } from '../components/Page.js';
import { Time } from '../components/Time.js';
import { Stat, Stats } from '../components/Stat.js';
import { Table } from '../components/Table.js';
import { count } from '../lib/format.js';
import { useAsync } from '../lib/state.js';

/**
 * The golden set: the reading everything else is scored against.
 *
 * Who read each part and when is the point of this page. The set was read by
 * the same model family that is being scored (D47), which is the limit on
 * what the evaluation can prove — and a human pass is what would change that.
 */

interface GoldenRow {
  readonly file: string;
  readonly mpn: string;
  readonly manufacturer: string;
  readonly reason: string;
  readonly readBy: string;
  readonly readAt: string;
  readonly pageCount: number;
}

interface GoldenHealth {
  readonly parts: number;
  readonly issues: readonly { readonly kind: string; readonly detail: string }[];
  readonly coverage: Readonly<Record<string, number>>;
  readonly thin: readonly string[];
}

export function Golden(): ReactNode {
  const { api } = useApp();
  const golden = useAsync('golden', () =>
    api.golden().then((value) => value.parts as unknown as readonly GoldenRow[]),
  );
  const health = useAsync('goldenHealth', () =>
    api.goldenHealth().then((value) => value as unknown as GoldenHealth),
  );

  return (
    <Page title="Golden set" subtitle="The hand reading every extraction is scored against">
      <Async state={health.state} label="the health checks">
        {(value) => (
          <>
            <Stats>
              <Stat label="Parts" value={count(value.parts)} note="in the set" />
              <Stat
                label="Health"
                value={
                  value.issues.length === 0 ? 'Clean' : `${String(value.issues.length)} issues`
                }
                note="duplicate parts, thin coverage, missing citations"
              />
              <Stat
                label="Thinly covered"
                value={value.thin.length === 0 ? 'None' : String(value.thin.length)}
                note="parameters with fewer than three examples"
              />
            </Stats>
            {value.issues.length === 0 ? null : (
              <div className="panel" style={{ marginBottom: 16 }}>
                {value.issues.map((issue) => (
                  <p className="caption" key={`${issue.kind}:${issue.detail}`}>
                    <strong>{issue.kind}</strong> {issue.detail}
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </Async>
      <Async state={golden.state} label="The golden parts">
        {(value) => (
          <div className="panel">
            <Table<GoldenRow>
              rows={value}
              rowKey={(row) => row.mpn}
              columns={[
                { key: 'mpn', label: 'Part', render: (row) => row.mpn },
                { key: 'manufacturer', label: 'Manufacturer', render: (row) => row.manufacturer },
                { key: 'reason', label: 'Why it is in the set', render: (row) => row.reason },
                { key: 'pages', label: 'Pages', numeric: true, render: (row) => row.pageCount },
                { key: 'readBy', label: 'Read by', render: (row) => row.readBy },
                {
                  key: 'readAt',
                  label: 'Read',
                  sort: (row) => row.readAt,
                  render: (row) => <Time value={row.readAt} />,
                },
              ]}
            />
          </div>
        )}
      </Async>
    </Page>
  );
}
