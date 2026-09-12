import type { ReactNode } from 'react';

import { useApp } from '../app.js';
import { Async } from '../components/Async.js';
import { Page } from '../components/Page.js';
import { Table } from '../components/Table.js';
import { count, percent, usd, when } from '../lib/format.js';
import { navigate } from '../lib/router.js';
import { useAsync } from '../lib/state.js';
import type { EvalListing } from '../lib/types.js';

/** Every evaluation that has been run, newest first. */
export function Evals(): ReactNode {
  const { api } = useApp();
  const evals = useAsync('evals', () => api.evals());

  return (
    <Page
      title="evaluations"
      subtitle="what each prompt scored against the golden set, and what it cost to find out"
    >
      <Async state={evals.state} label="the evaluations">
        {(value) => (
          <div className="panel">
            <Table<EvalListing>
              rows={value.results}
              rowKey={(one) => one.id}
              empty="no evaluation has been run yet"
              columns={[
                {
                  key: 'prompt',
                  label: 'prompt',
                  render: (one) => (
                    <a
                      href={`/evals/${encodeURIComponent(one.id)}`}
                      onClick={(event) => {
                        event.preventDefault();
                        navigate(`/evals/${encodeURIComponent(one.id)}`);
                      }}
                    >
                      {one.promptVersion}
                    </a>
                  ),
                },
                { key: 'model', label: 'model', render: (one) => one.model },
                { key: 'parts', label: 'parts', numeric: true, render: (one) => count(one.parts) },
                {
                  key: 'recall',
                  label: 'recall',
                  numeric: true,
                  sort: (one) => one.recall,
                  render: (one) => percent(one.recall),
                },
                {
                  key: 'precision',
                  label: 'precision',
                  numeric: true,
                  sort: (one) => one.precision,
                  render: (one) => percent(one.precision),
                },
                {
                  key: 'citations',
                  label: 'citations exact',
                  numeric: true,
                  sort: (one) => one.provenanceAccuracy,
                  render: (one) => percent(one.provenanceAccuracy),
                },
                {
                  key: 'cost',
                  label: 'cost',
                  numeric: true,
                  sort: (one) => one.costUsd,
                  render: (one) => usd(one.costUsd),
                },
                {
                  key: 'starved',
                  label: 'starved',
                  numeric: true,
                  render: (one) => (one.starved === 0 ? '—' : count(one.starved)),
                },
                { key: 'when', label: 'run', render: (one) => when(one.startedAt) },
              ]}
            />
            <p className="caption" style={{ marginTop: 8 }}>
              a starved part wanted something the cache did not have, so its score measures the
              cache rather than the prompt.
            </p>
          </div>
        )}
      </Async>
    </Page>
  );
}
