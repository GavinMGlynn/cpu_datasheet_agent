import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import type { BarShapeInput } from './shape.js';

import { Chart } from './Chart.js';
import { bucketLabel, bucketTooltip } from './formatters.js';
import { rampColor } from './palette.js';

/** A distribution over equal-width buckets: magnitude again, so one hue. */

/**
 * One bucket, drawn with the colour its own count earns.
 *
 * Recharts deprecated `Cell` in favour of this, and the shape has to be a
 * function rather than a colour because the fill is a function of the value.
 */
export function bucketShape(fill: (value: number) => string): (input: BarShapeInput) => ReactNode {
  return (input: BarShapeInput): ReactNode => {
    const { x, y, width, height } = input;
    const value = typeof input.value === 'number' ? input.value : 0;
    if (x === undefined || y === undefined || width === undefined || height === undefined) {
      return <g />;
    }
    return (
      <rect
        x={x}
        y={y}
        width={Math.max(0, width)}
        height={Math.max(0, height)}
        rx={4}
        ry={4}
        fill={fill(value)}
      />
    );
  };
}

export interface HistogramBucket {
  readonly from: number;
  readonly to: number;
  readonly count: number;
}

export interface HistogramProps {
  readonly title: string;
  readonly caption?: string;
  readonly buckets: readonly HistogramBucket[];
  readonly format: (value: number) => string;
  readonly height?: number;
  readonly empty?: string;
}

export function Histogram(props: HistogramProps): ReactNode {
  const height = props.height ?? 220;
  const largest = props.buckets.reduce((max, bucket) => Math.max(max, bucket.count), 0);
  const rows = props.buckets.map((bucket) => ({
    ...bucket,
    label: props.format(bucket.from),
  }));
  return (
    <Chart
      title={props.title}
      {...(props.caption === undefined ? {} : { caption: props.caption })}
      rows={rows}
      height={height}
      {...(props.empty === undefined ? {} : { empty: props.empty })}
      columns={[
        { label: 'from', value: (row) => props.format(row.from) },
        { label: 'to', value: (row) => props.format(row.to) },
        { label: 'parts', value: (row) => String(row.count) },
      ]}
    >
      {(width) => (
        <BarChart
          width={width}
          height={height}
          data={rows}
          margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
          barCategoryGap={2}
        >
          <CartesianGrid strokeDasharray="2 4" vertical={false} className="grid" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} width={32} />
          <Tooltip formatter={bucketTooltip} labelFormatter={bucketLabel} />
          <Bar
            dataKey="count"
            isAnimationActive={false}
            shape={bucketShape((count) => rampColor(largest === 0 ? 0 : count / largest))}
          />
        </BarChart>
      )}
    </Chart>
  );
}
