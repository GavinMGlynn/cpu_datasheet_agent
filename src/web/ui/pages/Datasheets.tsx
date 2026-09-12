import type { ReactNode } from 'react';
import { useState } from 'react';

import { useApp } from '../app.js';
import type { Api } from '../lib/api.js';
import { Async } from '../components/Async.js';
import { Page } from '../components/Page.js';
import { Table } from '../components/Table.js';
import { TextField } from '../components/Fields.js';
import { shortId, when } from '../lib/format.js';
import { useAsync } from '../lib/state.js';

/**
 * The datasheets themselves.
 *
 * Addressed by digest rather than by part, because one datasheet commonly
 * covers a whole family — which is the gotcha this project was built around.
 */

type DatasheetRow = Awaited<ReturnType<Api['datasheets']>>['datasheets'][number];

export function Datasheets(): ReactNode {
  const { api, source } = useApp();
  const [open, setOpen] = useState<{ sha256: string; page: number } | undefined>(undefined);
  // What is typed in the page box, kept apart from the page being shown: a
  // half-typed number is not a page.
  const [pageText, setPageText] = useState('1');
  const [search, setSearch] = useState('');
  const datasheets = useAsync(`datasheets:${source}`, () => api.datasheets(source));

  return (
    <Page title="datasheets" subtitle="every PDF this database has read, and what it covers">
      <Async state={datasheets.state} label="the datasheets">
        {(value) => (
          <>
            <div className="panel">
              <Table<DatasheetRow>
                rows={value.datasheets}
                rowKey={(row) => row.sha256}
                empty="no datasheet has been stored yet"
                columns={[
                  {
                    key: 'digest',
                    label: 'digest',
                    render: (row) => <span className="mono">{shortId(row.sha256, 12)}</span>,
                  },
                  {
                    key: 'parts',
                    label: 'covers',
                    render: (row) => (row.parts.length === 0 ? '—' : row.parts.join(', ')),
                  },
                  { key: 'pages', label: 'pages', numeric: true, render: (row) => row.pageCount },
                  { key: 'fetched', label: 'fetched', render: (row) => when(row.fetchedAt) },
                  {
                    key: 'open',
                    label: '',
                    render: (row) => (
                      <button
                        type="button"
                        className="link"
                        onClick={() => {
                          setOpen({ sha256: row.sha256, page: 1 });
                          setPageText('1');
                        }}
                      >
                        read it
                      </button>
                    ),
                  },
                ]}
              />
            </div>
            {open === undefined ? null : (
              <div className="panel" style={{ marginTop: 16 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h3 style={{ margin: 0 }}>page {open.page}</h3>
                  <span className="row">
                    <TextField
                      label="page"
                      type="number"
                      value={pageText}
                      onChange={(next) => {
                        setPageText(next);
                        const asked = Number(next);
                        if (Number.isInteger(asked) && asked >= 1) {
                          setOpen({ ...open, page: asked });
                        }
                      }}
                    />
                    <TextField label="find on this datasheet" value={search} onChange={setSearch} />
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setOpen(undefined);
                      }}
                    >
                      close
                    </button>
                  </span>
                </div>
                <img
                  alt={`page ${String(open.page)}`}
                  src={api.pageImageUrl(open.sha256, open.page, source)}
                  style={{ maxWidth: '100%', border: '1px solid var(--line)' }}
                />
              </div>
            )}
          </>
        )}
      </Async>
    </Page>
  );
}
