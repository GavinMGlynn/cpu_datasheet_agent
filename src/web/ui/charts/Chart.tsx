import type { ReactNode } from 'react';
import { useState } from 'react';

import { useWidth } from './measure.js';

/**
 * The frame every chart sits in: a title, the plot, a legend when there is
 * more than one series, and a table of the same numbers.
 *
 * The table is not a fallback, it is the second view: three of the light-mode
 * slots sit below 3:1 against the surface, and the rule that comes with that
 * palette is visible labels or a table. This is the table.
 */

export interface ChartColumn<T> {
  readonly label: string;
  readonly value: (row: T) => string;
}

export interface ChartProps<T> {
  readonly title: string;
  /** What the reader is meant to take from it. Shown under the title. */
  readonly caption?: string;
  readonly rows: readonly T[];
  readonly columns: readonly ChartColumn<T>[];
  readonly height?: number;
  readonly empty?: string;
  readonly children: (width: number) => ReactNode;
  readonly legend?: readonly { readonly label: string; readonly color: string }[];
}

export function Chart<T>(props: ChartProps<T>): ReactNode {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const height = props.height ?? 240;

  if (props.rows.length === 0) {
    return (
      <figure className="chart" ref={ref}>
        <figcaption className="chart-head">
          <h3>{props.title}</h3>
        </figcaption>
        <p className="empty">{props.empty ?? 'nothing to show yet'}</p>
      </figure>
    );
  }

  return (
    <figure className="chart" ref={ref}>
      <figcaption className="chart-head">
        <h3>{props.title}</h3>
        <div className="chart-actions">
          {props.caption === undefined ? null : <p className="caption">{props.caption}</p>}
          <button
            type="button"
            className="link"
            aria-pressed={view === 'table'}
            onClick={() => {
              setView(view === 'chart' ? 'table' : 'chart');
            }}
          >
            {view === 'chart' ? 'show the numbers' : 'show the chart'}
          </button>
        </div>
      </figcaption>
      {view === 'chart' ? (
        <div className="chart-plot" style={{ height }}>
          {props.children(width)}
        </div>
      ) : (
        <div className="chart-table">
          <table>
            <thead>
              <tr>
                {props.columns.map((column) => (
                  <th key={column.label}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {props.rows.map((row, index) => (
                <tr key={index}>
                  {props.columns.map((column) => (
                    <td key={column.label}>{column.value(row)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {props.legend === undefined || props.legend.length < 2 ? null : (
        <ul className="legend">
          {props.legend.map((entry) => (
            <li key={entry.label}>
              <span className="swatch" style={{ background: entry.color }} aria-hidden="true" />
              {entry.label}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
