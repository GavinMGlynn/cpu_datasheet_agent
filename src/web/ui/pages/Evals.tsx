import type { ReactNode } from 'react';

import { useApp } from '../app.js';
import { Async } from '../components/Async.js';
import { Page } from '../components/Page.js';
import { Time } from '../components/Time.js';
import { Table } from '../components/Table.js';
import { count, percent, usd } from '../lib/format.js';
import { navigate } from '../lib/router.js';
import { useAsync } from '../lib/state.js';
import type { EvalListing } from '../lib/types.js';

/** Every evaluation that has been run, newest first. */
export function Evals(): ReactNode {
  const { api } = useApp();
  const evals = useAsync('evals', () => api.evals());

  return (
    <Page
      title="Evaluations"
      subtitle="What each prompt scored against the golden set, and what it cost to find out"
    >
      <Async state={evals.state} label="the evaluations">
        {(value) => (
          <div className="panel">
            <Table<EvalListing>
              rows={value.results}
              rowKey={(one) => one.id}
              empty="No evaluation has been run yet."
              columns={[
                {
                  key: 'prompt',
                  label: 'Prompt',
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
                { key: 'model', label: 'Model', render: (one) => one.model },
                { key: 'parts', label: 'Parts', numeric: true, render: (one) => count(one.parts) },
                {
                  key: 'recall',
                  label: 'Recall',
                  numeric: true,
                  sort: (one) => one.recall,
                  render: (one) => percent(one.recall),
                },
                {
                  key: 'precision',
                  label: 'Precision',
                  numeric: true,
                  sort: (one) => one.precision,
                  render: (one) => percent(one.precision),
                },
                {
                  key: 'citations',
                  label: 'Citations exact',
                  numeric: true,
                  sort: (one) => one.provenanceAccuracy,
                  render: (one) => percent(one.provenanceAccuracy),
                },
                {
                  key: 'cost',
                  label: 'Cost',
                  numeric: true,
                  sort: (one) => one.costUsd,
                  render: (one) => usd(one.costUsd),
                },
                {
                  key: 'starved',
                  label: 'Starved',
                  numeric: true,
                  render: (one) => (one.starved === 0 ? '—' : count(one.starved)),
                },
                { key: 'when', label: 'Run', render: (one) => <Time value={one.startedAt} /> },
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
