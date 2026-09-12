import type { ReactNode } from 'react';

import { useApp } from '../app.js';
import { Bars } from '../charts/Bars.js';
import { TimeSeries } from '../charts/TimeSeries.js';
import { Async } from '../components/Async.js';
import { Page } from '../components/Page.js';
import { Select } from '../components/Fields.js';
import { count, usd } from '../lib/format.js';
import { navigate, withQuery } from '../lib/router.js';
import { useAsync } from '../lib/state.js';

/**
 * Where the money went.
 *
 * Spend over time, then the same money cut the way the question is usually
 * asked — by model, by prompt version, by part, by how the run ended.
 */

const DIMENSIONS = [
  { value: 'model', label: 'by model' },
  { value: 'promptVersion', label: 'by prompt version' },
  { value: 'kind', label: 'by kind of run' },
  { value: 'result', label: 'by how it ended' },
  { value: 'mpn', label: 'by part' },
];

export function Costs(): ReactNode {
  const { api, source, route } = useApp();
  const granularity = route.query.get('granularity') ?? 'day';
  const dimension = route.query.get('dimension') ?? 'model';
  const spend = useAsync(`spend:${source}:${granularity}`, () => api.spend(source, granularity));
  const breakdown = useAsync(`spendBy:${source}:${dimension}`, () =>
    api.spendBy(dimension, source),
  );

  return (
    <Page title="cost" subtitle="what the agent work has cost, and what it bought">
      <div className="filters">
        <Select
          label="over"
          value={granularity}
          options={[
            { value: 'hour', label: 'hours' },
            { value: 'day', label: 'days' },
            { value: 'week', label: 'weeks' },
            { value: 'month', label: 'months' },
          ]}
          onChange={(value) => {
            navigate(withQuery(route, { granularity: value }));
          }}
        />
        <Select
          label="broken down"
          value={dimension}
          options={DIMENSIONS}
          onChange={(value) => {
            navigate(withQuery(route, { dimension: value }));
          }}
        />
      </div>
      <Async state={spend.state} label="spending over time">
        {(value) => (
          <TimeSeries
            title="spent, and spent in total"
            caption="both lines are dollars, so they share one axis"
            rows={value.points}
          />
        )}
      </Async>
      <Async state={breakdown.state} label="the breakdown">
        {(value) => (
          <Bars
            title={`spend ${DIMENSIONS.find((one) => one.value === dimension)?.label ?? ''}`}
            caption="darker is dearer; the number beside each bar is the total"
            rows={value.breakdown.map((row) => ({
              label: row.key,
              value: row.costUsd,
              note: `${count(row.runs)} runs, ${usd(row.meanCostUsd)} each, ${count(row.unsuccessful)} without a part`,
            }))}
            format={(number) => usd(number)}
            empty="nothing has been spent in this database"
          />
        )}
      </Async>
    </Page>
  );
}
