import type { ReactNode } from 'react';

import type { Provenance as ProvenanceValue } from '../lib/types.js';
import { labelOr } from '../lib/labels.js';

/**
 * Where a value came from.
 *
 * Every parameter carries this, and a datasheet value carries a page number —
 * the project's first rule. The page number is a link to the page image, so
 * the claim can be checked rather than taken.
 */

export interface ProvenanceProps {
  readonly provenance: ProvenanceValue;
  readonly onOpenPage?: (page: number) => void;
}

export function Provenance(props: ProvenanceProps): ReactNode {
  const { provenance } = props;
  if (provenance.source === 'datasheet' && provenance.page !== undefined) {
    const page = provenance.page;
    return (
      <span className="badge" title={provenance.quote ?? 'Read from the datasheet'}>
        {props.onOpenPage === undefined ? (
          `Page ${String(page)}`
        ) : (
          <button
            type="button"
            className="link"
            onClick={() => {
              props.onOpenPage?.(page);
            }}
          >
            Page {page}
          </button>
        )}
      </span>
    );
  }
  if (provenance.source === 'distributor') {
    return <span className="badge">{labelOr(provenance.distributor, 'Distributor')}</span>;
  }
  if (provenance.source === 'human') {
    return (
      <span className="badge" title={provenance.note ?? 'Entered by a person'}>
        By hand
      </span>
    );
  }
  return (
    <span className="badge" title={provenance.rule ?? 'Derived by a rule'}>
      Derived
    </span>
  );
}
