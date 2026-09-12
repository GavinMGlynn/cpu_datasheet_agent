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
  { value: 'model', label: 'By model' },
  { value: 'promptVersion', label: 'By prompt version' },
  { value: 'kind', label: 'By kind of run' },
  { value: 'result', label: 'By how it ended' },
  { value: 'mpn', label: 'By part' },
];

export function Costs(): ReactNode {
  const { api, source, route } = useApp();
  const asked = route.query.get('granularity');
  const granularity = asked ?? 'day';
  const dimension = route.query.get('dimension') ?? 'model';
  // Nobody chose this bucket, and everything landed inside one of them: the
  // chart would be a single point, so it drops to the hour. A bucket the
  // reader picked is left exactly as they picked it.
  const spend = useAsync(`spend:${source}:${granularity}`, async () => {
    const chosen = await api.spend(source, granularity);
    if (asked !== null || chosen.points.length > 1) {
      return chosen;
    }
    return api.spend(source, 'hour');
  });
  const breakdown = useAsync(`spendBy:${source}:${dimension}`, () =>
    api.spendBy(dimension, source),
  );

  return (
    <Page title="Cost" subtitle="What the agent work has cost, and what it bought">
      <div className="filters">
        <Select
          label="Over"
          value={granularity}
          options={[
            { value: 'hour', label: 'Hours' },
            { value: 'day', label: 'Days' },
            { value: 'week', label: 'Weeks' },
            { value: 'month', label: 'Months' },
          ]}
          onChange={(value) => {
            navigate(withQuery(route, { granularity: value }));
          }}
        />
        <Select
          label="Broken down"
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
            title="Spent, and spent in total"
            caption="Both lines are dollars, so they share one axis"
            rows={value.points}
          />
        )}
      </Async>
      <Async state={breakdown.state} label="The breakdown">
        {(value) => (
          <Bars
            title={`Spend ${(DIMENSIONS.find((one) => one.value === dimension)?.label ?? '').toLowerCase()}`}
            caption="Darker is dearer; the number beside each bar is the total"
            rows={value.breakdown.map((row) => ({
              label: row.key,
              value: row.costUsd,
              note: `${count(row.runs)} runs, ${usd(row.meanCostUsd)} each, ${count(row.unsuccessful)} without a part`,
            }))}
            format={(number) => usd(number)}
            empty="Nothing has been spent in this database."
          />
        )}
      </Async>
    </Page>
  );
}
