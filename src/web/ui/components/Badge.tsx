import type { ReactNode } from 'react';

import { STATUS } from '../charts/palette.js';

/**
 * State, as a word with a colour beside it.
 *
 * Never colour alone: the status palette is reserved for state and always
 * ships with the label, which is what makes it readable to someone who
 * cannot tell the colours apart.
 */

const PART_STATUS: Readonly<Record<string, string>> = Object.freeze({
  verified: STATUS.good,
  extracted: STATUS.warning,
  needs_human: STATUS.serious,
  rejected: STATUS.critical,
});

const VERDICT: Readonly<Record<string, string>> = Object.freeze({
  confirmed: STATUS.good,
  not_found: STATUS.warning,
  contradicted: STATUS.critical,
});

const RUN_RESULT: Readonly<Record<string, string>> = Object.freeze({
  extracted: STATUS.good,
  verified: STATUS.good,
  needs_human: STATUS.serious,
  rejected: STATUS.critical,
  unfinished: STATUS.warning,
});

const LAUNCH_STATE: Readonly<Record<string, string>> = Object.freeze({
  running: STATUS.warning,
  finished: STATUS.good,
  cancelled: STATUS.serious,
  failed: STATUS.critical,
});

const CONFIDENCE: Readonly<Record<string, string>> = Object.freeze({
  verified: STATUS.good,
  extracted: STATUS.warning,
  conflict: STATUS.critical,
});

export type BadgeKind = 'partStatus' | 'verdict' | 'runResult' | 'launchState' | 'confidence';

const TABLES: Readonly<Record<BadgeKind, Readonly<Record<string, string>>>> = Object.freeze({
  partStatus: PART_STATUS,
  verdict: VERDICT,
  runResult: RUN_RESULT,
  launchState: LAUNCH_STATE,
  confidence: CONFIDENCE,
});

export interface BadgeProps {
  readonly kind: BadgeKind;
  readonly value: string | undefined;
}

export function Badge(props: BadgeProps): ReactNode {
  const value = props.value ?? 'unknown';
  const colour = TABLES[props.kind][value];
  return (
    <span className="badge">
      {colour === undefined ? null : (
        <span className="dot" style={{ background: colour }} aria-hidden="true" />
      )}
      {value.replace(/_/gu, ' ')}
    </span>
  );
}
