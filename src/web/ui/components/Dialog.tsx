import type { ReactNode } from 'react';
import { useEffect } from 'react';

/**
 * A question that has to be answered before something happens.
 *
 * Used for the things that cost money or change stored data. Escape closes
 * it, which is the answer "no".
 */

export interface DialogProps {
  readonly title: string;
  readonly children: ReactNode;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly busy?: boolean;
  readonly confirmDisabled?: boolean;
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
      <div className="dialog" role="dialog" aria-modal="true" aria-label={props.title}>
        <h3>{props.title}</h3>
        {props.children}
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            cancel
          </button>
          <button
            type="button"
            className="action"
            disabled={props.busy === true || props.confirmDisabled === true}
            onClick={props.onConfirm}
          >
            {props.busy === true ? 'working…' : props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
