import type { ReactNode } from 'react';

import { useApp } from '../app.js';
import { Bars } from '../charts/Bars.js';
import { Async } from '../components/Async.js';
import { Page } from '../components/Page.js';
import { Table } from '../components/Table.js';
import { count, duration, percent } from '../lib/format.js';
import { useAsync } from '../lib/state.js';
import type { ErrorStat, ToolStat } from '../lib/types.js';

/**
 * How the tool surface behaves: what gets called, what fails, what is slow.
 *
 * The ledger is the source, so these are measurements of what happened rather
 * than of what the tools are meant to do.
 */

export function Tools(): ReactNode {
  const { api } = useApp();
  const tools = useAsync('tools', () => api.tools());
  const errors = useAsync('errors', () => api.errors());

  return (
    <Page title="tools" subtitle="every tool call the ledger holds, counted and timed">
      <Async state={tools.state} label="the tools">
        {(value) => (
          <>
            <Bars
              title="calls by tool"
              caption="the busiest tools are the ones worth making faster or cheaper"
              rows={value.tools.map((tool) => ({
                label: tool.tool,
                value: tool.calls,
                note: `${count(tool.failures)} failed`,
              }))}
              format={(number) => count(number)}
            />
            <div className="panel">
              <Table<ToolStat>
                rows={value.tools}
                rowKey={(tool) => tool.tool}
                initialSort="calls"
                initialDirection="desc"
                columns={[
                  {
                    key: 'tool',
                    label: 'tool',
                    sort: (tool) => tool.tool,
                    render: (tool) => tool.tool,
                  },
                  {
                    key: 'calls',
                    label: 'calls',
                    numeric: true,
                    sort: (tool) => tool.calls,
                    render: (tool) => count(tool.calls),
                  },
                  {
                    key: 'failures',
                    label: 'failed',
                    numeric: true,
                    sort: (tool) => tool.failures,
                    render: (tool) =>
                      tool.failures === 0
                        ? '—'
                        : `${count(tool.failures)} (${percent(tool.failureRate, 0)})`,
                  },
                  {
                    key: 'spending',
                    label: 'may spend',
                    numeric: true,
                    sort: (tool) => tool.spending,
                    render: (tool) => count(tool.spending),
                  },
                  {
                    key: 'p50',
                    label: 'median',
                    numeric: true,
                    sort: (tool) => tool.duration?.p50,
                    render: (tool) => duration(tool.duration?.p50),
                  },
                  {
                    key: 'p90',
                    label: '90th',
                    numeric: true,
                    sort: (tool) => tool.duration?.p90,
                    render: (tool) => duration(tool.duration?.p90),
                  },
                  {
                    key: 'total',
                    label: 'total time',
                    numeric: true,
                    sort: (tool) => tool.totalMs,
                    render: (tool) => duration(tool.totalMs),
                  },
                ]}
              />
            </div>
          </>
        )}
      </Async>
      <Async state={errors.state} label="the failures">
        {(value) => (
          <div className="panel" style={{ marginTop: 16 }}>
            <h3>what has failed</h3>
            <Table<ErrorStat>
              rows={value.errors}
              rowKey={(error) => error.code}
              empty="nothing has failed in this ledger"
              columns={[
                { key: 'code', label: 'code', render: (error) => <code>{error.code}</code> },
                {
                  key: 'count',
                  label: 'times',
                  numeric: true,
                  sort: (error) => error.count,
                  render: (error) => count(error.count),
                },
                { key: 'tools', label: 'from', render: (error) => error.tools.join(', ') },
                { key: 'message', label: 'most recently', render: (error) => error.message },
              ]}
            />
          </div>
        )}
      </Async>
    </Page>
  );
}
