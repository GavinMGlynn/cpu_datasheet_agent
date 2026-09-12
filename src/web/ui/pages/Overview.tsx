import type { ReactNode } from 'react';

import { useApp } from '../app.js';
import { TimeSeries } from '../charts/TimeSeries.js';
import { Async } from '../components/Async.js';
import { Badge } from '../components/Badge.js';
import { Page } from '../components/Page.js';
import { Stat, Stats } from '../components/Stat.js';
import { count, percent, usd } from '../lib/format.js';
import { useAsync } from '../lib/state.js';

/**
 * What this database holds and what it cost to put there.
 *
 * The five numbers a person asks first, then the one chart that answers
 * "where did the money go".
 */

interface Overview {
  readonly runs: {
    readonly runs: number;
    readonly finished: number;
    readonly costUsd: number;
    readonly turns: number;
    readonly byResult: Readonly<Record<string, number>>;
  };
  readonly value: {
    readonly parts: number;
    readonly parametersStated: number;
    readonly parametersVerified: number;
    readonly perPart: number;
    readonly perStatedParameter: number;
    readonly totalUsd: number;
  };
  readonly ledger: { readonly records: number; readonly failures: number };
  readonly cache: { readonly misses: number; readonly missRate: number };
  readonly gate: { readonly total: number; readonly decisions: Readonly<Record<string, number>> };
}

export function Overview(): ReactNode {
  const { api, source } = useApp();
  const overview = useAsync(`overview:${source}`, () =>
    api.overview(source).then((value) => value as unknown as Overview),
  );
  // A day is the right bucket for a project measured in weeks. When every run
  // happened inside one day — which is exactly what an evaluation looks like —
  // the chart would be a single point, so the hour stands in.
  const spend = useAsync(`spend:${source}`, async () => {
    const daily = await api.spend(source, 'day');
    if (daily.points.length > 1) {
      return { points: daily.points, period: 'day by day' };
    }
    const hourly = await api.spend(source, 'hour');
    return { points: hourly.points, period: 'hour by hour' };
  });

  return (
    <Page title="Overview" subtitle="What is stored here, and what it cost to find out">
      <Async state={overview.state} label="the totals">
        {(value) => (
          <>
            <Stats>
              <Stat label="Parts" value={count(value.value.parts)} note="stored in this database" />
              <Stat
                label="Parameters found"
                value={count(value.value.parametersStated)}
                note={`${count(value.value.parametersVerified)} confirmed by a verification pass`}
              />
              <Stat
                label="Spent"
                value={usd(value.value.totalUsd)}
                note={`${count(value.runs.runs)} runs, ${count(value.runs.turns)} turns`}
              />
              <Stat
                label="A part costs"
                value={usd(value.value.perPart)}
                note={`${usd(value.value.perStatedParameter)} a parameter`}
              />
              <Stat
                label="Tool calls"
                value={count(value.ledger.records)}
                note={`${count(value.cache.misses)} wanted something the cache lacked`}
              />
            </Stats>
            <div className="panel" style={{ marginBottom: 16 }}>
              <h3>How the runs ended</h3>
              <div className="row">
                {Object.entries(value.runs.byResult).length === 0 ? (
                  <span className="caption">Nothing has run against this database yet.</span>
                ) : (
                  Object.entries(value.runs.byResult).map(([result, howMany]) => (
                    <span className="row" key={result} style={{ gap: 6 }}>
                      <strong>{count(howMany)}</strong>
                      <Badge kind="runResult" value={result} />
                    </span>
                  ))
                )}
              </div>
              <p className="caption" style={{ marginTop: 10 }}>
                The money gate looked at {count(value.gate.total)} calls and refused{' '}
                {percent(
                  value.gate.total === 0 ? 0 : (value.gate.decisions.deny ?? 0) / value.gate.total,
                )}
                .
              </p>
            </div>
          </>
        )}
      </Async>
      <Async state={spend.state} label="the spending">
        {(value) => (
          <TimeSeries
            title={`What it has cost, ${value.period}`}
            caption="Model calls only; the distributor APIs are free at this volume"
            rows={value.points}
          />
        )}
      </Async>
    </Page>
  );
}
