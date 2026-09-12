import type { ReactNode } from 'react';

import { useApp } from '../app.js';
import { Async } from '../components/Async.js';
import { Page } from '../components/Page.js';
import { Stat, Stats } from '../components/Stat.js';
import { Table } from '../components/Table.js';
import { count, when } from '../lib/format.js';
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
    <Page title="golden set" subtitle="the hand reading every extraction is scored against">
      <Async state={health.state} label="the health checks">
        {(value) => (
          <>
            <Stats>
              <Stat label="parts" value={count(value.parts)} note="in the set" />
              <Stat
                label="health"
                value={
                  value.issues.length === 0 ? 'clean' : `${String(value.issues.length)} issues`
                }
                note="duplicate parts, thin coverage, missing citations"
              />
              <Stat
                label="thinly covered"
                value={value.thin.length === 0 ? 'none' : String(value.thin.length)}
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
      <Async state={golden.state} label="the golden parts">
        {(value) => (
          <div className="panel">
            <Table<GoldenRow>
              rows={value}
              rowKey={(row) => row.mpn}
              columns={[
                { key: 'mpn', label: 'part', render: (row) => row.mpn },
                { key: 'manufacturer', label: 'manufacturer', render: (row) => row.manufacturer },
                { key: 'reason', label: 'why it is in the set', render: (row) => row.reason },
                { key: 'pages', label: 'pages', numeric: true, render: (row) => row.pageCount },
                { key: 'readBy', label: 'read by', render: (row) => row.readBy },
                {
                  key: 'readAt',
                  label: 'read',
                  sort: (row) => row.readAt,
                  render: (row) => when(row.readAt),
                },
              ]}
            />
          </div>
        )}
      </Async>
    </Page>
  );
}
