import type { ReactNode } from 'react';
import { useState } from 'react';

import { useApp } from '../app.js';
import { Async } from '../components/Async.js';
import { Json } from '../components/Json.js';
import { Page } from '../components/Page.js';
import { Time } from '../components/Time.js';
import { Checkbox, TextField } from '../components/Fields.js';
import { Table } from '../components/Table.js';
import { count, duration, shortId } from '../lib/format.js';
import { navigate, withQuery } from '../lib/router.js';
import { useAsync } from '../lib/state.js';
import type { ToolCall } from '../lib/types.js';

/**
 * Every tool call, searchable.
 *
 * The ledger is the project's record of what actually happened; this is the
 * window onto it, filters and all.
 */

export function Ledger(): ReactNode {
  const { api, route } = useApp();
  const [selected, setSelected] = useState<ToolCall | undefined>(undefined);
  const text = route.query.get('text') ?? '';
  const tool = route.query.get('tool') ?? '';
  const failed = route.query.get('failed') === 'true';
  const offset = Number(route.query.get('offset') ?? '0');

  const calls = useAsync(`ledger:${text}:${tool}:${String(failed)}:${String(offset)}`, () =>
    api.ledger({
      limit: 50,
      offset,
      ...(text === '' ? {} : { text }),
      ...(tool === '' ? {} : { tool }),
      ...(failed ? { failed: true } : {}),
    }),
  );

  return (
    <Page title="Ledger" subtitle="Every tool call this project has made, with what it did">
      <div className="filters">
        <TextField
          label="Search the tool and its input"
          value={text}
          onChange={(value) => {
            navigate(withQuery(route, { text: value, offset: undefined }));
          }}
        />
        <TextField
          label="One tool"
          value={tool}
          placeholder="read_pages"
          onChange={(value) => {
            navigate(withQuery(route, { tool: value, offset: undefined }));
          }}
        />
        <Checkbox
          label="Only the ones that failed"
          checked={failed}
          onChange={(checked) => {
            navigate(withQuery(route, { failed: checked ? 'true' : undefined, offset: undefined }));
          }}
        />
      </div>
      <Async state={calls.state} label="the ledger">
        {(page) => (
          <>
            <p className="caption">
              {count(page.total)} calls match; showing {count(page.items.length)}
            </p>
            <div className="split">
              <div className="panel">
                <Table<ToolCall>
                  rows={page.items}
                  rowKey={(call) => call.id}
                  empty="Nothing matches."
                  columns={[
                    {
                      key: 'tool',
                      label: 'Tool',
                      render: (call) => (
                        <button
                          type="button"
                          className="link"
                          onClick={() => {
                            setSelected(call);
                          }}
                        >
                          {call.tool}
                        </button>
                      ),
                    },
                    {
                      key: 'when',
                      label: 'When',
                      render: (call) => <Time value={call.startedAt} />,
                    },
                    {
                      key: 'took',
                      label: 'Took',
                      numeric: true,
                      render: (call) => duration(call.durationMs),
                    },
                    {
                      key: 'outcome',
                      label: 'Outcome',
                      render: (call) =>
                        call.error === undefined ? 'ok' : <code>{call.error.code}</code>,
                    },
                    {
                      key: 'session',
                      label: 'Session',
                      render: (call) => <span className="mono">{shortId(call.sessionId)}</span>,
                    },
                  ]}
                />
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
              </div>
              <div className="panel">
                <h3>{selected === undefined ? 'Pick a call' : selected.tool}</h3>
                {selected === undefined ? (
                  <p className="caption">The input and the output, as they were recorded.</p>
                ) : (
                  <>
                    <Json value={selected.input} label="What went in" />
                    <p className="caption" style={{ marginTop: 8 }}>
                      {selected.error === undefined ? 'What came back' : 'What went wrong'}
                    </p>
                    <Json value={selected.error ?? selected.output} label="What came back" />
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </Async>
    </Page>
  );
}
