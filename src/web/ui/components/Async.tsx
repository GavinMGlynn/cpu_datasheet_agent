import type { ReactNode } from 'react';

import { ApiError } from '../lib/api.js';
import type { AsyncState } from '../lib/state.js';

/**
 * Loading, failed, or loaded — all three rendered.
 *
 * A failure shows the server's own code, because "DB_PART_NOT_FOUND" tells
 * you what happened and "something went wrong" tells you nothing.
 */

export interface AsyncProps<T> {
  readonly state: AsyncState<T>;
  readonly children: (value: T) => ReactNode;
  readonly label?: string;
}

export function Async<T>(props: AsyncProps<T>): ReactNode {
  if (props.state.status === 'loading') {
    return (
      <p className="caption" role="status">
        Loading {props.label ?? ''}…
      </p>
    );
  }
  if (props.state.status === 'failed') {
    const error = props.state.error;
    return (
      <div className="failed" role="alert">
        <strong>That didn’t work.</strong>{' '}
        {error instanceof ApiError ? (
          <>
            <code>{error.code}</code> — {error.message}
          </>
        ) : (
          error.message
        )}
      </div>
    );
  }
  return props.children(props.state.value);
}
