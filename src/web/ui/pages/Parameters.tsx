import type { ReactNode } from 'react';

import { useApp } from '../app.js';
import { HeatMap } from '../charts/HeatMap.js';
import { Histogram } from '../charts/Histogram.js';
import { Async } from '../components/Async.js';
import { Page } from '../components/Page.js';
import { Select } from '../components/Fields.js';
import { engineering, percent } from '../lib/format.js';
import { navigate, withQuery } from '../lib/router.js';
import { useAsync } from '../lib/state.js';

/**
 * What the pipeline reliably finds, and what it does not.
 *
 * The coverage grid is the view this project needed most: `maxDutyCycle`
 * stated for ten parts of twenty-two is a convention nobody decided, and it
 * is invisible one part at a time.
 */

export function Parameters(): ReactNode {
  const { api, source, route } = useApp();
  const key = route.query.get('key') ?? 'vinMax';
  const coverage = useAsync(`coverage:${source}`, () => api.coverage(source));
  const distribution = useAsync(`distribution:${source}:${key}`, () =>
    api.distribution(key, source, 8),
  );

  return (
    <Page title="Parameters" subtitle="How much of the schema the extraction actually fills in">
      <Async state={coverage.state} label="the coverage grid">
        {(value) => (
          <>
            <HeatMap
              title="Parameters by parts"
              caption="How many parts state each parameter, cite a page for it, and have had it confirmed"
              rows={value.coverage.map((cell) => cell.key)}
              columns={['found', 'cited', 'confirmed', 'disputed']}
              max={value.coverage[0]?.parts ?? 1}
              cells={value.coverage.flatMap((cell) => [
                {
                  row: cell.key,
                  column: 'found',
                  value: cell.stated,
                  title: `${cell.key}: stated for ${String(cell.stated)} of ${String(cell.parts)} parts`,
                },
                {
                  row: cell.key,
                  column: 'cited',
                  value: cell.cited,
                  title: `${cell.key}: cites a datasheet page for ${String(cell.cited)} parts`,
                },
                {
                  row: cell.key,
                  column: 'confirmed',
                  value: cell.verified,
                  title: `${cell.key}: confirmed for ${String(cell.verified)} parts`,
                },
                {
                  row: cell.key,
                  column: 'disputed',
                  value: cell.conflicted + cell.contradicted,
                  title: `${cell.key}: ${String(cell.conflicted)} in conflict, ${String(cell.contradicted)} contradicted`,
                },
              ])}
            />
            <div className="filters">
              <Select
                label="Distribution of"
                value={key}
                options={value.coverage.map((cell) => ({ value: cell.key, label: cell.key }))}
                onChange={(next) => {
                  navigate(withQuery(route, { key: next }));
                }}
              />
              <p className="caption">
                the weakest three:{' '}
                {[...value.coverage]
                  .sort((a, b) => a.coverage - b.coverage)
                  .slice(0, 3)
                  .map((cell) => `${cell.key} ${percent(cell.coverage, 0)}`)
                  .join(', ')}
              </p>
            </div>
          </>
        )}
      </Async>
      <Async state={distribution.state} label="The distribution">
        {(value) => (
          <>
            {/* Outside the chart: where there is nothing to plot, this
                sentence is the whole answer. */}
            <p className="caption">
              {value.summary === undefined
                ? 'No part states a number for this parameter'
                : `${String(value.summary.count)} parts state a number; ${String(value.nonNumeric)} do not`}
            </p>
            <Histogram
              title={`${key} across the set`}
              buckets={value.buckets}
              format={(number) => engineering(number, value.unit ?? 'count')}
              empty="No numeric values to plot."
            />
          </>
        )}
      </Async>
    </Page>
  );
}
