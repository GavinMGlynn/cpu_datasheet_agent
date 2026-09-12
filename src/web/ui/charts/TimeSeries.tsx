import type { ReactNode } from 'react';
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';

import { usd } from '../lib/format.js';
import { moneyTick, moneyTooltip } from './formatters.js';
import { Chart } from './Chart.js';
import { seriesColor } from './palette.js';

/**
 * Spend over time.
 *
 * Two lines on one axis, both in dollars: what a bucket cost and what has been
 * spent in total. Never a second y-axis — the two measures share a scale
 * because they share a unit, and where they would not, this would be two
 * charts.
 */

export interface SpendRow {
  readonly key: string;
  readonly costUsd: number;
  readonly cumulativeUsd: number;
  readonly runs: number;
}

export interface TimeSeriesProps {
  readonly title: string;
  readonly caption?: string;
  readonly rows: readonly SpendRow[];
  readonly height?: number;
}

export function TimeSeries(props: TimeSeriesProps): ReactNode {
  const perBucket = seriesColor(0);
  const cumulative = seriesColor(1);
  return (
    <Chart
      title={props.title}
      {...(props.caption === undefined ? {} : { caption: props.caption })}
      rows={props.rows}
      height={props.height ?? 260}
      empty="no runs in this window"
      legend={[
        { label: 'spent', color: perBucket },
        { label: 'spent in total', color: cumulative },
      ]}
      columns={[
        { label: 'when', value: (row) => row.key },
        { label: 'runs', value: (row) => String(row.runs) },
        { label: 'spent', value: (row) => usd(row.costUsd) },
        { label: 'in total', value: (row) => usd(row.cumulativeUsd) },
      ]}
    >
      {(width) => (
        <LineChart
          width={width}
          height={props.height ?? 260}
          data={[...props.rows]}
          margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
        >
          <CartesianGrid strokeDasharray="2 4" className="grid" />
          <XAxis dataKey="key" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis
            tickFormatter={moneyTick}
            tickLine={false}
            axisLine={false}
            fontSize={12}
            width={64}
          />
          <Tooltip formatter={moneyTooltip} />
          <Line
            type="monotone"
            dataKey="costUsd"
            name="spent"
            stroke={perBucket}
            strokeWidth={2}
            dot={{ r: 4 }}
          />
          <Line
            type="monotone"
            dataKey="cumulativeUsd"
            name="spent in total"
            stroke={cumulative}
            strokeWidth={2}
            dot={{ r: 4 }}
          />
        </LineChart>
      )}
    </Chart>
  );
}
