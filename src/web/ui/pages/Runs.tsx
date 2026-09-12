import type { ReactNode } from 'react';

import { useApp } from '../app.js';
import { Async } from '../components/Async.js';
import { Badge } from '../components/Badge.js';
import { Page } from '../components/Page.js';
import { Select } from '../components/Fields.js';
import { Table } from '../components/Table.js';
import { count, duration, usd, when } from '../lib/format.js';
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
    <Page title="runs" subtitle="what the agent has done, and what each attempt cost">
      <div className="filters">
        <Select
          label="kind"
          value={kind}
          options={[
            { value: '', label: 'either' },
            { value: 'extract', label: 'extraction' },
            { value: 'verify', label: 'verification' },
          ]}
          onChange={(value) => {
            navigate(withQuery(route, { kind: value }));
          }}
        />
        <Select
          label="ended"
          value={result}
          options={[
            { value: '', label: 'any way' },
            { value: 'extracted', label: 'a part stored' },
            { value: 'verified', label: 'every value checked' },
            { value: 'needs_human', label: 'a question raised' },
            { value: 'rejected', label: 'rejected' },
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
              empty="no run matches those filters"
              columns={[
                {
                  key: 'mpn',
                  label: 'part',
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
                { key: 'kind', label: 'kind', sort: (run) => run.kind, render: (run) => run.kind },
                {
                  key: 'result',
                  label: 'ended',
                  sort: (run) => run.result ?? 'unfinished',
                  render: (run) => <Badge kind="runResult" value={run.result ?? 'unfinished'} />,
                },
                {
                  key: 'cost',
                  label: 'cost',
                  numeric: true,
                  sort: (run) => run.costUsd,
                  render: (run) => usd(run.costUsd),
                },
                {
                  key: 'turns',
                  label: 'turns',
                  numeric: true,
                  sort: (run) => run.turns,
                  render: (run) => run.turns ?? '—',
                },
                {
                  key: 'calls',
                  label: 'tool calls',
                  numeric: true,
                  sort: (run) => run.details?.toolCalls,
                  render: (run) => run.details?.toolCalls ?? '—',
                },
                {
                  key: 'took',
                  label: 'took',
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
                  label: 'model',
                  sort: (run) => run.model,
                  render: (run) => run.model,
                },
                {
                  key: 'started',
                  label: 'started',
                  sort: (run) => run.startedAt,
                  render: (run) => when(run.startedAt),
                },
              ]}
            />
          </div>
        )}
      </Async>
    </Page>
  );
}
