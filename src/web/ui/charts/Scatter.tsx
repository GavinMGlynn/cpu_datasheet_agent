import type { ReactNode } from 'react';
import {
  CartesianGrid,
  Scatter as RechartsScatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';

import { Chart } from './Chart.js';
import { pairTooltip, tickWith } from './formatters.js';
import { seriesColor } from './palette.js';

/**
 * Two measures against each other — price against current, cost against
 * turns.
 *
 * At most three series: scatter puts every pair of colours on screen at once,
 * and the palette's first three slots are the ones that clear the all-pairs
 * floors. A fourth group folds into "other".
 */

export interface ScatterPoint {
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly group?: string;
}

export interface ScatterProps {
  readonly title: string;
  readonly caption?: string;
  readonly points: readonly ScatterPoint[];
  readonly xLabel: string;
  readonly yLabel: string;
  readonly formatX: (value: number) => string;
  readonly formatY: (value: number) => string;
  readonly height?: number;
}

export const MAX_SCATTER_SERIES = 3;

export function Scatter(props: ScatterProps): ReactNode {
  const height = props.height ?? 280;
  const groups = [...new Set(props.points.map((point) => point.group ?? 'all'))];
  const shown = groups.slice(0, MAX_SCATTER_SERIES);
  const folded = groups.length > MAX_SCATTER_SERIES;
  const series = folded ? [...shown, 'other'] : shown;
  const pointsOf = (group: string): ScatterPoint[] =>
    props.points.filter((point) => {
      const own = point.group ?? 'all';
      return group === 'other' ? !shown.includes(own) : own === group;
    });

  return (
    <Chart
      title={props.title}
      {...(props.caption === undefined ? {} : { caption: props.caption })}
      rows={props.points}
      height={height}
      empty="nothing to plot yet"
      legend={series.map((group, index) => ({ label: group, color: seriesColor(index) }))}
      columns={[
        { label: 'part', value: (point) => point.label },
        { label: props.xLabel, value: (point) => props.formatX(point.x) },
        { label: props.yLabel, value: (point) => props.formatY(point.y) },
      ]}
    >
      {(width) => (
        <ScatterChart
          width={width}
          height={height}
          margin={{ top: 8, right: 24, bottom: 24, left: 8 }}
        >
          <CartesianGrid strokeDasharray="2 4" className="grid" />
          <XAxis
            type="number"
            dataKey="x"
            name={props.xLabel}
            tickFormatter={tickWith(props.formatX)}
            tickLine={false}
            fontSize={11}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={props.yLabel}
            tickFormatter={tickWith(props.formatY)}
            tickLine={false}
            fontSize={11}
            width={64}
          />
          <ZAxis range={[64, 64]} />
          <Tooltip
            cursor={{ strokeDasharray: '2 4' }}
            formatter={pairTooltip(props.xLabel, props.formatX, props.formatY)}
          />
          {series.map((group, index) => (
            <RechartsScatter
              key={group}
              name={group}
              data={pointsOf(group)}
              fill={seriesColor(index)}
              isAnimationActive={false}
            />
          ))}
        </ScatterChart>
      )}
    </Chart>
  );
}
