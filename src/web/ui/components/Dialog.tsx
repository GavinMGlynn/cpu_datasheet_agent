import type { ReactNode } from 'react';
import { useEffect } from 'react';

/**
 * Something that has to be dealt with before the page carries on.
 *
 * Two shapes, one component: a question with an answer — used for everything
 * that costs money or changes stored data — and a viewer with nothing to
 * confirm, for reading something too big to sit in a table. Escape closes
 * either, which is the answer "no".
 */

export interface DialogProps {
  readonly title: string;
  readonly children: ReactNode;
  /** Present on a question; absent on a viewer, which has nothing to agree to. */
  readonly confirmLabel?: string;
  readonly onConfirm?: () => void;
  readonly onCancel: () => void;
  /** What the way out of a question is called. A viewer's always says Close. */
  readonly cancelLabel?: string;
  readonly busy?: boolean;
  readonly confirmDisabled?: boolean;
  /** Room for a page image rather than a paragraph. */
  readonly wide?: boolean;
}

export function Dialog(props: DialogProps): ReactNode {
  const { onCancel } = props;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };
    globalThis.addEventListener('keydown', onKey);
    return () => {
      globalThis.removeEventListener('keydown', onKey);
    };
  }, [onCancel]);

  return (
    <div className="dialog-backdrop">
      <div
        className={props.wide === true ? 'dialog wide' : 'dialog'}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
      >
        <div className="dialog-head">
          <h3>{props.title}</h3>
          {/* A viewer's way out belongs at the top: what it holds is taller
              than the screen, and a button under it cannot be reached. */}
          {props.confirmLabel === undefined ? (
            <button type="button" className="secondary" onClick={onCancel}>
              Close
            </button>
          ) : null}
        </div>
        {props.children}
        {props.confirmLabel === undefined ? null : (
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={onCancel}>
              {props.cancelLabel ?? 'Cancel'}
            </button>
            <button
              type="button"
              className="action"
              disabled={props.busy === true || props.confirmDisabled === true}
              onClick={props.onConfirm}
            >
              {props.busy === true ? 'Working…' : props.confirmLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
