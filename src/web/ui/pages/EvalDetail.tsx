import type { ReactNode } from 'react';

import { useApp } from '../app.js';
import { Bars } from '../charts/Bars.js';
import { Async } from '../components/Async.js';
import { Page } from '../components/Page.js';
import { Stat, Stats } from '../components/Stat.js';
import { Table } from '../components/Table.js';
import { count, parameterValue, percent, usd } from '../lib/format.js';
import { navigate } from '../lib/router.js';
import { useAsync } from '../lib/state.js';
import type { ParameterScoreRow } from '../lib/types.js';

/**
 * One evaluation, parameter by parameter.
 *
 * The table sorts worst first, because the question this page answers is
 * "what should the next prompt fix".
 */

interface FailureRow {
  readonly mpn: string;
  readonly key: string;
  readonly score: string;
  readonly page: string;
  readonly expected: unknown;
  readonly actual: unknown;
}

interface Report {
  readonly promptVersion: string;
  readonly model: string;
  readonly costUsd: number;
  readonly turns: number;
  readonly starved: readonly string[];
  readonly set: {
    readonly recall: number;
    readonly precision: number;
    readonly provenanceAccuracy: number;
    readonly withinOnePage: number;
  };
  readonly parts: readonly {
    readonly mpn: string;
    readonly score: { readonly recall: number; readonly precision: number };
    readonly run: { readonly costUsd?: number; readonly turns?: number };
  }[];
}

export interface EvalDetailProps {
  readonly id: string;
}

export function EvalDetail(props: EvalDetailProps): ReactNode {
  const { api } = useApp();
  const report = useAsync(`eval:${props.id}`, () =>
    api.evalReport(props.id).then((value) => value.report as unknown as Report),
  );
  const parameters = useAsync(`evalParameters:${props.id}`, () => api.evalParameters(props.id));
  const failures = useAsync(`evalFailures:${props.id}`, () =>
    api.evalFailures(props.id).then((value) => value.failures as unknown as readonly FailureRow[]),
  );

  return (
    <Page
      title="Evaluation"
      subtitle={props.id}
      actions={
        <button
          type="button"
          className="secondary"
          onClick={() => {
            navigate('/evals');
          }}
        >
          Back to evaluations
        </button>
      }
    >
      <Async state={report.state} label="the result">
        {(value) => (
          <>
            <Stats>
              <Stat label="Prompt" value={value.promptVersion} note={value.model} />
              <Stat
                label="Recall"
                value={percent(value.set.recall)}
                note="of what the golden set states"
              />
              <Stat
                label="Precision"
                value={percent(value.set.precision)}
                note="of what it claimed"
              />
              <Stat
                label="Citations exact"
                value={percent(value.set.provenanceAccuracy)}
                note={`${percent(value.set.withinOnePage)} within a page`}
              />
              <Stat
                label="Cost"
                value={usd(value.costUsd)}
                note={`${count(value.turns)} turns over ${count(value.parts.length)} parts`}
              />
            </Stats>
            {value.starved.length === 0 ? null : (
              <div className="panel" style={{ marginBottom: 16 }}>
                <p className="caption">
                  {count(value.starved.length)} parts wanted something the cache did not have:{' '}
                  {value.starved.join(', ')}. their scores measure the cache, not the prompt.
                </p>
              </div>
            )}
          </>
        )}
      </Async>

      <Async state={parameters.state} label="The parameter scores">
        {(value) => (
          <>
            <Bars
              title="Accuracy by parameter, worst first"
              caption="How often each parameter was right, of the times either side stated it"
              rows={value.parameters
                .filter((row) => row.stated > 0)
                .map((row) => ({
                  label: row.key,
                  value: row.accuracy,
                  note: `${String(row.correct)} of ${String(row.stated)}`,
                }))}
              format={(number) => percent(number, 0)}
            />
            <div className="panel">
              <Table<ParameterScoreRow>
                rows={value.parameters}
                rowKey={(row) => row.key}
                columns={[
                  { key: 'key', label: 'Parameter', render: (row) => row.key },
                  {
                    key: 'accuracy',
                    label: 'Right',
                    numeric: true,
                    sort: (row) => row.accuracy,
                    render: (row) => `${String(row.correct)}/${String(row.stated)}`,
                  },
                  {
                    key: 'citation',
                    label: 'Cited exactly',
                    numeric: true,
                    sort: (row) => row.citationExact,
                    render: (row) => count(row.citationExact),
                  },
                  {
                    key: 'wrong',
                    label: 'Wrong for',
                    render: (row) =>
                      row.wrongParts.length === 0 ? '—' : row.wrongParts.join(', '),
                  },
                  {
                    key: 'missing',
                    label: 'Missed for',
                    render: (row) =>
                      row.missingParts.length === 0 ? '—' : row.missingParts.join(', '),
                  },
                ]}
              />
            </div>
          </>
        )}
      </Async>

      <Async state={failures.state} label="The failures">
        {(value) => (
          <div className="panel" style={{ marginTop: 16 }}>
            <h3>Every value that did not match</h3>
            <Table<FailureRow>
              rows={value}
              rowKey={(row) => `${row.mpn}:${row.key}`}
              empty="Every value matched the golden reading."
              columns={[
                { key: 'mpn', label: 'Part', render: (row) => row.mpn },
                { key: 'key', label: 'Parameter', render: (row) => row.key },
                { key: 'score', label: 'What happened', render: (row) => row.score },
                { key: 'expected', label: 'Golden', render: (row) => parameterValue(row.expected) },
                {
                  key: 'actual',
                  label: 'Extracted',
                  render: (row) => parameterValue(row.actual),
                },
                { key: 'page', label: 'Citation', render: (row) => row.page },
              ]}
            />
          </div>
        )}
      </Async>
    </Page>
  );
}
