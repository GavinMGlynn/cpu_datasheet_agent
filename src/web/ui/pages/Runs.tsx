import type { ReactNode } from 'react';

import { useApp } from '../app.js';
import { Async } from '../components/Async.js';
import { Badge } from '../components/Badge.js';
import { Page } from '../components/Page.js';
import { Time } from '../components/Time.js';
import { Select } from '../components/Fields.js';
import { Table } from '../components/Table.js';
import { count, duration, usd } from '../lib/format.js';
import { navigate, withQuery } from '../lib/router.js';
import { useAsync } from '../lib/state.js';
import type { Run } from '../lib/types.js';

/** Every run this database has recorded: what it cost, and how it ended. */
export function Runs(): ReactNode {
  const { api, source, route } = useApp();
  const kind = route.query.get('kind') ?? '';
  const result = route.query.get('result') ?? '';
  const runs = useAsync(`runs:${source}:${kind}:${result}`, () =>
    api.runs({
      source,
      limit: 500,
      ...(kind === '' ? {} : { kind }),
      ...(result === '' ? {} : { result }),
    }),
  );

  return (
    <Page title="Runs" subtitle="What the agent has done, and what each attempt cost">
      <div className="filters">
        <Select
          label="Kind"
          value={kind}
          options={[
            { value: '', label: 'Either' },
            { value: 'extract', label: 'Extraction' },
            { value: 'verify', label: 'Verification' },
          ]}
          onChange={(value) => {
            navigate(withQuery(route, { kind: value }));
          }}
        />
        <Select
          label="Ended"
          value={result}
          options={[
            { value: '', label: 'Any way' },
            { value: 'extracted', label: 'A part stored' },
            { value: 'verified', label: 'Every value checked' },
            { value: 'needs_human', label: 'A question raised' },
            { value: 'rejected', label: 'Rejected' },
          ]}
          onChange={(value) => {
            navigate(withQuery(route, { result: value }));
          }}
        />
      </div>
      <Async state={runs.state} label="the runs">
        {(page) => (
          <div className="panel">
            <p className="caption">{count(page.total)} runs</p>
            <Table<Run>
              rows={page.items}
              rowKey={(run) => run.id}
              initialSort="started"
              initialDirection="desc"
              empty="No run matches those filters."
              columns={[
                {
                  key: 'mpn',
                  label: 'Part',
                  sort: (run) => run.mpn,
                  render: (run) => (
                    <a
                      href={`/runs/${run.id}`}
                      onClick={(event) => {
                        event.preventDefault();
                        navigate(`/runs/${run.id}`);
                      }}
                    >
                      {run.mpn}
                    </a>
                  ),
                },
                { key: 'kind', label: 'Kind', sort: (run) => run.kind, render: (run) => run.kind },
                {
                  key: 'result',
                  label: 'Ended',
                  sort: (run) => run.result ?? 'unfinished',
                  render: (run) => <Badge kind="runResult" value={run.result ?? 'unfinished'} />,
                },
                {
                  key: 'cost',
                  label: 'Cost',
                  numeric: true,
                  sort: (run) => run.costUsd,
                  render: (run) => usd(run.costUsd),
                },
                {
                  key: 'turns',
                  label: 'Turns',
                  numeric: true,
                  sort: (run) => run.turns,
                  render: (run) => run.turns ?? '—',
                },
                {
                  key: 'calls',
                  label: 'Tool calls',
                  numeric: true,
                  sort: (run) => run.details?.toolCalls,
                  render: (run) => run.details?.toolCalls ?? '—',
                },
                {
                  key: 'took',
                  label: 'Took',
                  numeric: true,
                  sort: (run) =>
                    run.endedAt === undefined
                      ? undefined
                      : Date.parse(run.endedAt) - Date.parse(run.startedAt),
                  render: (run) =>
                    run.endedAt === undefined
                      ? '—'
                      : duration(Date.parse(run.endedAt) - Date.parse(run.startedAt)),
                },
                {
                  key: 'model',
                  label: 'Model',
                  sort: (run) => run.model,
                  render: (run) => run.model,
                },
                {
                  key: 'started',
                  label: 'Started',
                  sort: (run) => run.startedAt,
                  render: (run) => <Time value={run.startedAt} />,
                },
              ]}
            />
          </div>
        )}
      </Async>
    </Page>
  );
}
