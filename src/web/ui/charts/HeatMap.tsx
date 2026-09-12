import type { ReactNode } from 'react';
import { useState } from 'react';

import { rampColor } from './palette.js';

/**
 * A grid of magnitudes: parameters down, a measure across.
 *
 * Hand-drawn SVG rather than a chart library, because what this needs is a
 * grid of rectangles with a legible label on each row — and because the
 * colour has to come off the same sequential ramp as every other magnitude
 * in the site. Each cell carries its own number, so the colour is a second
 * encoding rather than the only one.
 */

export interface HeatCell {
  readonly row: string;
  readonly column: string;
  readonly value: number;
  /** What the cell means in words, for the tooltip and the screen reader. */
  readonly title: string;
}

export interface HeatMapProps {
  readonly title: string;
  readonly caption?: string;
  readonly rows: readonly string[];
  readonly columns: readonly string[];
  readonly cells: readonly HeatCell[];
  /** The value that colours darkest. Defaults to the largest cell. */
  readonly max?: number;
  readonly format?: (value: number) => string;
}

const CELL = 44;
const ROW_HEIGHT = 22;
const LABEL_WIDTH = 168;

export function HeatMap(props: HeatMapProps): ReactNode {
  const [hovered, setHovered] = useState<HeatCell | undefined>(undefined);
  const format = props.format ?? ((value: number): string => String(value));
  const max = props.max ?? props.cells.reduce((largest, cell) => Math.max(largest, cell.value), 0);
  const width = LABEL_WIDTH + props.columns.length * CELL;
  const height = props.rows.length * ROW_HEIGHT + 24;
  const at = (row: string, column: string): HeatCell | undefined =>
    props.cells.find((cell) => cell.row === row && cell.column === column);

  if (props.rows.length === 0) {
    return (
      <figure className="chart">
        <figcaption className="chart-head">
          <h3>{props.title}</h3>
        </figcaption>
        <p className="empty">nothing stored yet</p>
      </figure>
    );
  }

  return (
    <figure className="chart heatmap">
      <figcaption className="chart-head">
        <h3>{props.title}</h3>
        {props.caption === undefined ? null : <p className="caption">{props.caption}</p>}
      </figcaption>
      <div className="chart-plot" style={{ overflowX: 'auto' }}>
        <svg width={width} height={height} role="img" aria-label={props.title}>
          {props.columns.map((column, index) => (
            <text
              key={column}
              x={LABEL_WIDTH + index * CELL + CELL / 2}
              y={14}
              textAnchor="middle"
              className="heat-axis"
            >
              {column}
            </text>
          ))}
          {props.rows.map((row, rowIndex) => (
            <g key={row}>
              <text x={0} y={24 + rowIndex * ROW_HEIGHT + 15} className="heat-axis">
                {row}
              </text>
              {props.columns.map((column, columnIndex) => {
                const cell = at(row, column);
                const value = cell?.value ?? 0;
                return (
                  <g key={column}>
                    <rect
                      x={LABEL_WIDTH + columnIndex * CELL + 1}
                      y={24 + rowIndex * ROW_HEIGHT + 1}
                      width={CELL - 2}
                      height={ROW_HEIGHT - 2}
                      rx={3}
                      fill={rampColor(max === 0 ? 0 : value / max)}
                      onMouseEnter={() => {
                        setHovered(cell);
                      }}
                      onMouseLeave={() => {
                        setHovered(undefined);
                      }}
                    >
                      <title>{cell?.title ?? `${row} ${column}`}</title>
                    </rect>
                    <text
                      x={LABEL_WIDTH + columnIndex * CELL + CELL / 2}
                      y={24 + rowIndex * ROW_HEIGHT + 15}
                      textAnchor="middle"
                      className={
                        value / (max === 0 ? 1 : max) > 0.55 ? 'heat-value on' : 'heat-value'
                      }
                    >
                      {format(value)}
                    </text>
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
      </div>
      <p className="caption" aria-live="polite">
        {hovered === undefined ? ' ' : hovered.title}
      </p>
    </figure>
  );
}
