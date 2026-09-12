import type { ReactNode } from 'react';

/**
 * A single number that leads a page.
 *
 * A one-bar bar chart is not a chart, it is a number with decoration. These
 * are the numbers.
 */

export interface StatProps {
  readonly label: string;
  readonly value: string;
  readonly note?: string;
}

export function Stat(props: StatProps): ReactNode {
  return (
    <div className="card">
      <div className="label">{props.label}</div>
      <div className="value">{props.value}</div>
      {props.note === undefined ? null : <div className="note">{props.note}</div>}
    </div>
  );
}

export function Stats(props: { readonly children: ReactNode }): ReactNode {
  return <div className="cards">{props.children}</div>;
}
