import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, Tooltip, XAxis, YAxis } from 'recharts';
import type { BarShapeInput } from './shape.js';

import { Chart } from './Chart.js';
import { tickWith, tooltipWith } from './formatters.js';
import { rampColor, seriesColor } from './palette.js';

/**
 * Magnitude, low to high.
 *
 * One hue, more-is-darker: the job here is "how big", not "which one", so the
 * colour is sequential and the identity is carried by the label beside each
 * bar. Horizontal, because the things being compared have names — tools,
 * models, part numbers — and a name is easier to read across than down.
 */

export interface BarRow {
  readonly label: string;
  readonly value: number;
  /** Second line under the label, such as a count behind a total. */
  readonly note?: string;
}

export interface BarsProps {
  readonly title: string;
  readonly caption?: string;
  readonly rows: readonly BarRow[];
  readonly format: (value: number) => string;
  readonly height?: number;
  readonly empty?: string;
  /** Highlights one row and greys the rest: the emphasis form. */
  readonly highlight?: string;
}

/**
 * One bar, drawn with the colour its own magnitude earns.
 *
 * Recharts deprecated `Cell` in favour of this, and the shape has to be a
 * function rather than a colour because the fill is a function of the value.
 */
export function barShape(fill: (value: number) => string): (input: BarShapeInput) => ReactNode {
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

export function Bars(props: BarsProps): ReactNode {
  const rows = [...props.rows].sort((a, b) => b.value - a.value);
  const largest = rows.reduce((max, row) => Math.max(max, row.value), 0);
  const height = props.height ?? Math.max(120, rows.length * 28 + 40);
  const highlighted = rows.find((row) => row.label === props.highlight)?.value;
  return (
    <Chart
      title={props.title}
      {...(props.caption === undefined ? {} : { caption: props.caption })}
      rows={rows}
      height={height}
      {...(props.empty === undefined ? {} : { empty: props.empty })}
      columns={[
        { label: 'what', value: (row) => row.label },
        { label: 'how much', value: (row) => props.format(row.value) },
        { label: 'note', value: (row) => row.note ?? '' },
      ]}
    >
      {(width) => (
        <BarChart
          layout="vertical"
          width={width}
          height={height}
          data={rows}
          margin={{ top: 8, right: 72, bottom: 8, left: 8 }}
          barCategoryGap={2}
        >
          <CartesianGrid strokeDasharray="2 4" horizontal={false} className="grid" />
          <XAxis type="number" hide domain={[0, largest === 0 ? 1 : largest]} />
          <YAxis
            type="category"
            dataKey="label"
            width={168}
            tickLine={false}
            axisLine={false}
            fontSize={12}
          />
          <Tooltip formatter={tooltipWith(props.format)} />
          <Bar
            dataKey="value"
            isAnimationActive={false}
            shape={barShape((value) =>
              props.highlight === undefined
                ? rampColor(largest === 0 ? 0 : value / largest)
                : value === highlighted
                  ? seriesColor(0)
                  : '#cdccc4',
            )}
          >
            <LabelList
              dataKey="value"
              position="right"
              className="bar-label"
              formatter={tickWith(props.format)}
            />
          </Bar>
        </BarChart>
      )}
    </Chart>
  );
}
