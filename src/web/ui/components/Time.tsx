import type { ReactNode } from 'react';

import { exactly, relative } from '../lib/format.js';

/**
 * An instant, as a person reads it.
 *
 * The words say how long ago; the tooltip and the accessible title say
 * exactly when, in the reader's own time zone. `<time datetime>` carries the
 * machine-readable original, so what is on the page and what is in the
 * database are the same fact in two forms.
 */

export interface TimeProps {
  readonly value: string | null | undefined;
  /** Fixed clock, for tests; the browser passes nothing. */
  readonly now?: Date;
}

export function Time(props: TimeProps): ReactNode {
  const { value } = props;
  if (value === null || value === undefined || value === '') {
    return <>—</>;
  }
  return (
    <time dateTime={value} title={exactly(value)}>
      {relative(value, props.now ?? new Date())}
    </time>
  );
}
