import type { ReactNode } from 'react';

/** Anything the site holds but does not yet render specially, readable. */
export function Json(props: { readonly value: unknown; readonly label?: string }): ReactNode {
  return (
    <pre className="json" aria-label={props.label ?? 'JSON'}>
      {JSON.stringify(props.value, null, 2)}
    </pre>
  );
}
