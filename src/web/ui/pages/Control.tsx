import type { ReactNode } from 'react';
import { useState } from 'react';

import { useApp } from '../app.js';
import { Async } from '../components/Async.js';
import { Badge } from '../components/Badge.js';
import { Checkbox, Select, TextField } from '../components/Fields.js';
import { Dialog } from '../components/Dialog.js';
import { Page } from '../components/Page.js';
import { Table } from '../components/Table.js';
import { count, errorMessage, usd, when } from '../lib/format.js';
import { useAsync } from '../lib/state.js';
import type { Launch } from '../lib/types.js';

/**
 * Starting runs, and watching them.
 *
 * Nothing starts without the estimate in front of you and a reason typed in.
 * The three money gates are the ones the command line uses; the fourth — a
 * ceiling for the whole launch — is stated here because a batch of twenty is
 * a different decision from one run (D64).
 */

interface Estimate {
  readonly parts: number;
  readonly basis: number;
  readonly meanCostUsd: number;
  readonly estimateUsd: number;
  readonly worstCaseUsd: number;
  readonly basisDescription: string;
}

export function Control(): ReactNode {
  const { api, source } = useApp();
  const [form, setForm] = useState({
    kind: 'extract',
    mpns: '',
    ceilingUsd: '10',
    maxCostUsd: '4',
    allowSpend: false,
    actor: 'gavin',
    reason: '',
  });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);

  const parts = form.mpns
    .split(',')
    .map((one) => one.trim())
    .filter((one) => one !== '');

  const launches = useAsync('launches', () => api.launches());
  const estimate = useAsync(`estimate:${source}:${form.kind}:${String(parts.length)}`, () =>
    api
      .estimate(form.kind, Math.max(1, parts.length), source)
      .then((value) => value as unknown as Estimate),
  );

  const start = (): void => {
    setBusy(true);
    setFailure(undefined);
    api
      .startLaunch({
        kind: form.kind,
        mpns: parts,
        actor: form.actor,
        reason: form.reason,
        ceilingUsd: Number(form.ceilingUsd),
        maxCostUsd: Number(form.maxCostUsd),
        allowSpend: form.allowSpend,
        confirmed: true,
      })
      .then(() => {
        setBusy(false);
        setConfirming(false);
        launches.reload();
      })
      .catch((error: unknown) => {
        setBusy(false);
        setFailure(errorMessage(error));
      });
  };

  return (
    <Page
      title="run control"
      subtitle="start an extraction or a verification, and watch what it costs"
    >
      <div className="filters">
        <Select
          label="what to run"
          value={form.kind}
          options={[
            { value: 'extract', label: 'extraction' },
            { value: 'verify', label: 'verification' },
          ]}
          onChange={(value) => {
            setForm({ ...form, kind: value });
          }}
        />
        <TextField
          label="parts, comma separated"
          value={form.mpns}
          placeholder="TPS54331DR, AP62200WU-7"
          onChange={(value) => {
            setForm({ ...form, mpns: value });
          }}
        />
        <TextField
          label="ceiling for the whole launch, dollars"
          type="number"
          value={form.ceilingUsd}
          onChange={(value) => {
            setForm({ ...form, ceilingUsd: value });
          }}
        />
        <TextField
          label="ceiling for one run, dollars"
          type="number"
          value={form.maxCostUsd}
          onChange={(value) => {
            setForm({ ...form, maxCostUsd: value });
          }}
        />
        <Checkbox
          label="let it spend at the distributors"
          checked={form.allowSpend}
          onChange={(checked) => {
            setForm({ ...form, allowSpend: checked });
          }}
        />
        <TextField
          label="why"
          value={form.reason}
          onChange={(value) => {
            setForm({ ...form, reason: value });
          }}
        />
        <TextField
          label="your name"
          value={form.actor}
          onChange={(value) => {
            setForm({ ...form, actor: value });
          }}
        />
        <button
          type="button"
          className="action"
          disabled={parts.length === 0 || form.reason.trim().length < 3}
          onClick={() => {
            setConfirming(true);
          }}
        >
          start it
        </button>
      </div>

      <Async state={estimate.state} label="the estimate">
        {(value) => (
          <div className="panel" style={{ marginBottom: 16 }}>
            <p className="caption">
              {parts.length === 0
                ? 'name some parts and this will say what they would cost.'
                : `${String(parts.length)} parts would cost about ${usd(value.estimateUsd)} — ${value.basisDescription}. allow ${usd(value.worstCaseUsd)} for a bad run.`}
            </p>
          </div>
        )}
      </Async>

      <Async state={launches.state} label="what is running">
        {(value) => (
          <div className="panel">
            <h3>launches</h3>
            <Table<Launch>
              rows={value.launches}
              rowKey={(launch) => launch.id}
              empty="nothing has been started from this browser"
              columns={[
                { key: 'kind', label: 'kind', render: (launch) => launch.kind },
                {
                  key: 'parts',
                  label: 'parts',
                  render: (launch) => launch.mpns.join(', '),
                },
                {
                  key: 'state',
                  label: 'state',
                  render: (launch) => <Badge kind="launchState" value={launch.state} />,
                },
                {
                  key: 'spent',
                  label: 'spent',
                  numeric: true,
                  render: (launch) =>
                    usd(launch.runs.reduce((sum, one) => sum + (one.costUsd ?? 0), 0)),
                },
                {
                  key: 'done',
                  label: 'done',
                  numeric: true,
                  render: (launch) => `${count(launch.runs.length)}/${count(launch.mpns.length)}`,
                },
                { key: 'started', label: 'started', render: (launch) => when(launch.startedAt) },
                {
                  key: 'cancel',
                  label: '',
                  render: (launch) =>
                    launch.state === 'running' ? (
                      <button
                        type="button"
                        className="link"
                        onClick={() => {
                          api
                            .cancelLaunch(launch.id)
                            .then(() => {
                              launches.reload();
                            })
                            .catch(() => {
                              launches.reload();
                            });
                        }}
                      >
                        stop after this part
                      </button>
                    ) : null,
                },
              ]}
            />
          </div>
        )}
      </Async>

      {!confirming ? null : (
        <Dialog
          title="this will spend money"
          confirmLabel="start the run"
          busy={busy}
          onCancel={() => {
            setConfirming(false);
          }}
          onConfirm={start}
        >
          <p>
            {form.kind === 'extract' ? 'extracting' : 'verifying'} {parts.length} part
            {parts.length === 1 ? '' : 's'}: <span className="mono">{parts.join(', ')}</span>
          </p>
          <Async state={estimate.state} label="the estimate">
            {(value) => (
              <p>
                about <strong>{usd(value.estimateUsd)}</strong>, {value.basisDescription}. it stops
                at <strong>{usd(Number(form.ceilingUsd))}</strong> for the launch and{' '}
                <strong>{usd(Number(form.maxCostUsd))}</strong> for any one run.
              </p>
            )}
          </Async>
          <p className="caption">
            {form.allowSpend
              ? 'it may fetch from the distributors, which uses quota.'
              : 'it may not spend at the distributors: anything not cached will come back as a refusal.'}
          </p>
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
