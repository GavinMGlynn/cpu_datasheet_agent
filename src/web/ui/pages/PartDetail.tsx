import type { ReactNode } from 'react';
import { useState } from 'react';

import { useApp } from '../app.js';
import { Async } from '../components/Async.js';
import { Badge } from '../components/Badge.js';
import { Dialog } from '../components/Dialog.js';
import { Json } from '../components/Json.js';
import { Page } from '../components/Page.js';
import { Provenance } from '../components/Provenance.js';
import { Stat, Stats } from '../components/Stat.js';
import { Table } from '../components/Table.js';
import { TextField } from '../components/Fields.js';
import { count, errorMessage, money, parameterValue, usd, when } from '../lib/format.js';
import { navigate } from '../lib/router.js';
import { useAsync } from '../lib/state.js';
import type { ParameterRow, Run } from '../lib/types.js';

/**
 * One part, with everything that hangs off it.
 *
 * The parameter table is the point: the value, where it came from, and what
 * the verification pass made of it — and a page number that opens the page,
 * so a claim can be checked rather than believed.
 */

export interface PartDetailProps {
  readonly mpn: string;
}

export function PartDetail(props: PartDetailProps): ReactNode {
  const { api, source } = useApp();
  const [page, setPage] = useState<number | undefined>(undefined);
  const [correcting, setCorrecting] = useState<ParameterRow | undefined>(undefined);
  const [form, setForm] = useState({ value: '', note: '', reason: '', actor: 'gavin' });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);

  const part = useAsync(`part:${source}:${props.mpn}`, () =>
    api.part(props.mpn, { source, quantity: 100 }),
  );

  const submit = (row: ParameterRow): void => {
    setBusy(true);
    setFailure(undefined);
    let parsed: unknown;
    try {
      parsed = JSON.parse(form.value);
    } catch {
      setBusy(false);
      setFailure('that is not JSON. A quantity looks like {"value": 28, "unit": "V"}.');
      return;
    }
    api
      .correctParameter(props.mpn, row.key, {
        value: parsed,
        note: form.note,
        reason: form.reason,
        actor: form.actor,
      })
      .then(() => {
        setBusy(false);
        setCorrecting(undefined);
        part.reload();
      })
      .catch((error: unknown) => {
        setBusy(false);
        setFailure(errorMessage(error));
      });
  };

  return (
    <Page
      title={props.mpn}
      subtitle="what is stored about this part, and where each value came from"
      actions={
        <button
          type="button"
          className="secondary"
          onClick={() => {
            navigate('/parts');
          }}
        >
          back to the catalogue
        </button>
      }
    >
      <Async state={part.state} label="the part">
        {(value) => (
          <>
            <Stats>
              <Stat label="manufacturer" value={value.summary.manufacturer} />
              <Stat
                label="status"
                value={value.summary.status.replace(/_/gu, ' ')}
                note={`${String(value.summary.parameters.verified)} parameters confirmed`}
              />
              <Stat
                label="parameters found"
                value={`${String(value.summary.parameters.stated)}/${String(value.summary.parameters.total)}`}
                note={`${String(value.summary.parameters.cited)} cite a datasheet page`}
              />
              <Stat
                label="each at 100"
                value={
                  value.summary.bestPrice === null
                    ? '—'
                    : money(value.summary.bestPrice.amount, value.summary.bestPrice.currency)
                }
                note={`${count(value.summary.stock)} in stock`}
              />
              <Stat
                label="checked"
                value={`${String(value.summary.verdicts.confirmed)} confirmed`}
                note={`${String(value.summary.verdicts.contradicted)} contradicted, ${String(value.summary.verdicts.unchecked)} unchecked`}
              />
            </Stats>

            {value.escalations.length === 0 ? null : (
              <div className="panel" style={{ marginBottom: 16 }}>
                <h3>questions raised about this part</h3>
                {value.escalations.map((escalation) => (
                  <p key={escalation.id} className="caption">
                    <Badge
                      kind="verdict"
                      value={escalation.resolution === undefined ? 'contradicted' : 'confirmed'}
                    />{' '}
                    {escalation.question}
                  </p>
                ))}
              </div>
            )}

            <div className="panel" style={{ marginBottom: 16 }}>
              <h3>parameters</h3>
              <Table<ParameterRow>
                rows={value.parameters}
                rowKey={(row) => row.key}
                columns={[
                  { key: 'key', label: 'parameter', render: (row) => row.key },
                  { key: 'value', label: 'value', render: (row) => parameterValue(row.value) },
                  {
                    key: 'confidence',
                    label: 'confidence',
                    render: (row) => <Badge kind="confidence" value={row.confidence} />,
                  },
                  {
                    key: 'provenance',
                    label: 'from',
                    render: (row) => (
                      <Provenance
                        provenance={row.provenance}
                        onOpenPage={(number) => {
                          setPage(number);
                        }}
                      />
                    ),
                  },
                  {
                    key: 'verdict',
                    label: 'checked',
                    render: (row) =>
                      row.verdict === undefined ? (
                        <span className="badge">not checked</span>
                      ) : (
                        <Badge kind="verdict" value={row.verdict.verdict} />
                      ),
                  },
                  {
                    key: 'correct',
                    label: '',
                    render: (row) => (
                      <button
                        type="button"
                        className="link"
                        onClick={() => {
                          setCorrecting(row);
                          setForm({
                            value: JSON.stringify(row.value),
                            note: '',
                            reason: '',
                            actor: form.actor,
                          });
                        }}
                      >
                        correct
                      </button>
                    ),
                  },
                ]}
              />
            </div>

            {value.summary.datasheet === undefined || page === undefined ? null : (
              <div className="panel" style={{ marginBottom: 16 }}>
                <h3>
                  datasheet page {page} of {value.summary.datasheet.pageCount}
                </h3>
                <img
                  alt={`page ${String(page)} of the datasheet for ${props.mpn}`}
                  src={api.pageImageUrl(value.summary.datasheet.sha256, page, source)}
                  style={{ maxWidth: '100%', border: '1px solid var(--line)' }}
                />
              </div>
            )}

            <div className="split">
              <div className="panel">
                <h3>offers</h3>
                <Json value={value.summary.distributors} label="distributors" />
                <p className="caption">
                  {count(value.summary.offerCount)} offers, {count(value.summary.stock)} in stock
                </p>
              </div>
              <div className="panel">
                <h3>runs</h3>
                <Table<Run>
                  rows={value.runs}
                  rowKey={(run) => run.id}
                  empty="no run has touched this part in this database"
                  columns={[
                    { key: 'kind', label: 'kind', render: (run) => run.kind },
                    {
                      key: 'result',
                      label: 'result',
                      render: (run) => (
                        <Badge kind="runResult" value={run.result ?? 'unfinished'} />
                      ),
                    },
                    {
                      key: 'cost',
                      label: 'cost',
                      numeric: true,
                      render: (run) => usd(run.costUsd),
                    },
                    { key: 'when', label: 'when', render: (run) => when(run.startedAt) },
                  ]}
                />
              </div>
            </div>

            <div className="panel" style={{ marginTop: 16 }}>
              <h3>this datasheet also covers</h3>
              <p className="caption">
                {value.datasheetMpns.length === 0
                  ? 'nothing else is recorded against it'
                  : value.datasheetMpns.join(', ')}
              </p>
            </div>
          </>
        )}
      </Async>

      {correcting === undefined ? null : (
        <Dialog
          title={`correct ${correcting.key}`}
          confirmLabel="store the correction"
          busy={busy}
          confirmDisabled={form.reason.trim().length < 3 || form.note.trim().length < 3}
          onCancel={() => {
            setCorrecting(undefined);
            setFailure(undefined);
          }}
          onConfirm={() => {
            submit(correcting);
          }}
        >
          <p className="caption">
            the value the model stored is kept in the audit trail. yours is stored beside it, with
            your name on it.
          </p>
          <TextField
            label="value, as JSON"
            value={form.value}
            onChange={(next) => {
              setForm({ ...form, value: next });
            }}
          />
          <TextField
            label="what you read, and where"
            value={form.note}
            placeholder="page 2, ordering information"
            onChange={(next) => {
              setForm({ ...form, note: next });
            }}
          />
          <TextField
            label="why you are changing it"
            value={form.reason}
            multiline
            onChange={(next) => {
              setForm({ ...form, reason: next });
            }}
          />
          <TextField
            label="your name"
            value={form.actor}
            onChange={(next) => {
              setForm({ ...form, actor: next });
            }}
          />
          {failure === undefined ? null : (
            <p className="danger" role="alert">
              {failure}
            </p>
          )}
        </Dialog>
      )}
    </Page>
  );
}
