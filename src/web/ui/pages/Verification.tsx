import type { ReactNode } from 'react';

import { useApp } from '../app.js';
import { HeatMap } from '../charts/HeatMap.js';
import { Async } from '../components/Async.js';
import { Page } from '../components/Page.js';
import { Stat, Stats } from '../components/Stat.js';
import { Table } from '../components/Table.js';
import { count } from '../lib/format.js';
import { navigate } from '../lib/router.js';
import { useAsync } from '../lib/state.js';
import type { PartSummary } from '../lib/types.js';

/**
 * What the verification pass made of what the extraction stored.
 *
 * Confirmed, contradicted, not found on the cited page, and never checked —
 * per part, because that is the unit a person acts on.
 */

export function Verification(): ReactNode {
  const { api, source } = useApp();
  const parts = useAsync(`verification:${source}`, () =>
    api.parts({ source, limit: 500, sort: 'mpn' }),
  );

  return (
    <Page
      title="Verification"
      subtitle="What a second pass, in a fresh context, made of each stored value"
    >
      <Async state={parts.state} label="the verdicts">
        {(page) => {
          const totals = page.items.reduce(
            (sum, part) => ({
              confirmed: sum.confirmed + part.verdicts.confirmed,
              contradicted: sum.contradicted + part.verdicts.contradicted,
              notFound: sum.notFound + part.verdicts.notFound,
              unchecked: sum.unchecked + part.verdicts.unchecked,
            }),
            { confirmed: 0, contradicted: 0, notFound: 0, unchecked: 0 },
          );
          return (
            <>
              <Stats>
                <Stat
                  label="Confirmed"
                  value={count(totals.confirmed)}
                  note="found on the cited page"
                />
                <Stat
                  label="Contradicted"
                  value={count(totals.contradicted)}
                  note="the page says something else"
                />
                <Stat
                  label="Not found"
                  value={count(totals.notFound)}
                  note="the cited page does not state it"
                />
                <Stat label="Unchecked" value={count(totals.unchecked)} note="nothing has looked" />
              </Stats>
              <HeatMap
                title="Verdicts by part"
                caption="A contradiction is worth reading; a value nothing has checked is worth running"
                rows={page.items.map((part) => part.mpn)}
                columns={['confirmed', 'contradicted', 'not found', 'unchecked']}
                cells={page.items.flatMap((part) => [
                  {
                    row: part.mpn,
                    column: 'confirmed',
                    value: part.verdicts.confirmed,
                    title: `${part.mpn}: ${String(part.verdicts.confirmed)} values confirmed`,
                  },
                  {
                    row: part.mpn,
                    column: 'contradicted',
                    value: part.verdicts.contradicted,
                    title: `${part.mpn}: ${String(part.verdicts.contradicted)} contradicted`,
                  },
                  {
                    row: part.mpn,
                    column: 'not found',
                    value: part.verdicts.notFound,
                    title: `${part.mpn}: ${String(part.verdicts.notFound)} not found on the cited page`,
                  },
                  {
                    row: part.mpn,
                    column: 'unchecked',
                    value: part.verdicts.unchecked,
                    title: `${part.mpn}: ${String(part.verdicts.unchecked)} never checked`,
                  },
                ])}
              />
              <div className="panel">
                <Table<PartSummary>
                  rows={page.items}
                  rowKey={(part) => part.mpn}
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
                      key: 'status',
                      label: 'Status',
                      render: (part) => part.status.replace(/_/gu, ' '),
                    },
                    {
                      key: 'confirmed',
                      label: 'Confirmed',
                      numeric: true,
                      sort: (part) => part.verdicts.confirmed,
                      render: (part) => count(part.verdicts.confirmed),
                    },
                    {
                      key: 'contradicted',
                      label: 'Contradicted',
                      numeric: true,
                      sort: (part) => part.verdicts.contradicted,
                      render: (part) => count(part.verdicts.contradicted),
                    },
                    {
                      key: 'notFound',
                      label: 'Not found',
                      numeric: true,
                      sort: (part) => part.verdicts.notFound,
                      render: (part) => count(part.verdicts.notFound),
                    },
                    {
                      key: 'unchecked',
                      label: 'Unchecked',
                      numeric: true,
                      sort: (part) => part.verdicts.unchecked,
                      render: (part) => count(part.verdicts.unchecked),
                    },
                  ]}
                />
              </div>
            </>
          );
        }}
      </Async>
    </Page>
  );
}
