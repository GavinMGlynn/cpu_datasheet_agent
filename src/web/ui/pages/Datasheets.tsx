import type { ReactNode } from 'react';
import { useState } from 'react';

import { useApp } from '../app.js';
import type { Api } from '../lib/api.js';
import { Async } from '../components/Async.js';
import { Dialog } from '../components/Dialog.js';
import { Page } from '../components/Page.js';
import { Table } from '../components/Table.js';
import { Time } from '../components/Time.js';
import { TextField } from '../components/Fields.js';
import { count, shortId } from '../lib/format.js';
import { useAsync } from '../lib/state.js';

/**
 * The datasheets themselves.
 *
 * Addressed by digest rather than by part, because one datasheet commonly
 * covers a whole family — which is the gotcha this project was built around.
 *
 * The reader is a dialog rather than a panel below the table: a page image is
 * a thousand pixels tall, and opening one underneath twenty rows of table put
 * it off the bottom of the screen, where pressing the button looked like it
 * had done nothing at all.
 */

type DatasheetRow = Awaited<ReturnType<Api['datasheets']>>['datasheets'][number];

interface Open {
  readonly sha256: string;
  readonly page: number;
  readonly pages: number;
  readonly covers: string;
}

export function Datasheets(): ReactNode {
  const { api, source } = useApp();
  const [open, setOpen] = useState<Open | undefined>(undefined);
  // What is typed in the page box, kept apart from the page being shown: a
  // half-typed number is not a page.
  const [pageText, setPageText] = useState('1');
  const datasheets = useAsync(`datasheets:${source}`, () => api.datasheets(source));

  return (
    <Page title="Datasheets" subtitle="Every PDF this database has read, and what it covers">
      <Async state={datasheets.state} label="the datasheets">
        {(value) => (
          <>
            <div className="panel">
              <Table<DatasheetRow>
                rows={value.datasheets}
                rowKey={(row) => row.sha256}
                empty="No datasheet has been stored yet."
                columns={[
                  {
                    key: 'digest',
                    label: 'Digest',
                    render: (row) => <span className="mono">{shortId(row.sha256, 12)}</span>,
                  },
                  {
                    key: 'parts',
                    label: 'Covers',
                    render: (row) => (row.parts.length === 0 ? '—' : row.parts.join(', ')),
                  },
                  {
                    key: 'pages',
                    label: 'Pages',
                    numeric: true,
                    sort: (row) => row.pageCount,
                    render: (row) => count(row.pageCount),
                  },
                  {
                    key: 'fetched',
                    label: 'Fetched',
                    sort: (row) => row.fetchedAt,
                    render: (row) => <Time value={row.fetchedAt} />,
                  },
                  {
                    key: 'open',
                    label: '',
                    numeric: true,
                    render: (row) => (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setOpen({
                            sha256: row.sha256,
                            page: 1,
                            pages: row.pageCount,
                            covers: row.parts.join(', '),
                          });
                          setPageText('1');
                        }}
                      >
                        View
                      </button>
                    ),
                  },
                ]}
              />
            </div>
            {open === undefined ? null : (
              <Dialog
                wide
                title={`${open.covers === '' ? shortId(open.sha256, 12) : open.covers} · page ${String(open.page)} of ${String(open.pages)}`}
                onCancel={() => {
                  setOpen(undefined);
                }}
              >
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="row">
                    <button
                      type="button"
                      className="secondary"
                      disabled={open.page <= 1}
                      onClick={() => {
                        setOpen({ ...open, page: open.page - 1 });
                        setPageText(String(open.page - 1));
                      }}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={open.page >= open.pages}
                      onClick={() => {
                        setOpen({ ...open, page: open.page + 1 });
                        setPageText(String(open.page + 1));
                      }}
                    >
                      Next
                    </button>
                  </span>
                  <TextField
                    label="Page"
                    type="number"
                    value={pageText}
                    onChange={(next) => {
                      setPageText(next);
                      const asked = Number(next);
                      if (Number.isInteger(asked) && asked >= 1 && asked <= open.pages) {
                        setOpen({ ...open, page: asked });
                      }
                    }}
                  />
                </div>
                <img
                  alt={`Page ${String(open.page)}`}
                  src={api.pageImageUrl(open.sha256, open.page, source)}
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-sm)',
                    marginTop: 12,
                    maxWidth: '100%',
                  }}
                />
              </Dialog>
            )}
          </>
        )}
      </Async>
    </Page>
  );
}
