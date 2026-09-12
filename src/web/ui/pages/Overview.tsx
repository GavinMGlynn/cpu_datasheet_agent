import type { ReactNode } from 'react';

import { useApp } from '../app.js';
import { TimeSeries } from '../charts/TimeSeries.js';
import { Async } from '../components/Async.js';
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
  const spend = useAsync(`spend:${source}`, () => api.spend(source, 'day'));

  return (
    <Page title="overview" subtitle="what is stored here, and what it cost to find out">
      <Async state={overview.state} label="the totals">
        {(value) => (
          <>
            <Stats>
              <Stat label="parts" value={count(value.value.parts)} note="stored in this database" />
              <Stat
                label="parameters found"
                value={count(value.value.parametersStated)}
                note={`${count(value.value.parametersVerified)} confirmed by a verification pass`}
              />
              <Stat
                label="spent"
                value={usd(value.value.totalUsd)}
                note={`${count(value.runs.runs)} runs, ${count(value.runs.turns)} turns`}
              />
              <Stat
                label="a part costs"
                value={usd(value.value.perPart)}
                note={`${usd(value.value.perStatedParameter)} a parameter`}
              />
              <Stat
                label="tool calls"
                value={count(value.ledger.records)}
                note={`${count(value.cache.misses)} wanted something the cache lacked`}
              />
            </Stats>
            <div className="panel" style={{ marginBottom: 16 }}>
              <p className="caption">
                how the runs ended:{' '}
                {Object.entries(value.runs.byResult)
                  .map(([result, n]) => `${String(n)} ${result.replace(/_/gu, ' ')}`)
                  .join(', ') || 'nothing has run yet'}
                . the money gate looked at {count(value.gate.total)} calls and refused{' '}
                {percent(
                  value.gate.total === 0 ? 0 : (value.gate.decisions.deny ?? 0) / value.gate.total,
                )}
                .
              </p>
            </div>
          </>
        )}
      </Async>
      <Async state={spend.state} label="spending">
        {(value) => (
          <TimeSeries
            title="what it has cost, day by day"
            caption="model calls only; the distributor APIs are free at this volume"
            rows={value.points}
          />
        )}
      </Async>
    </Page>
  );
}
