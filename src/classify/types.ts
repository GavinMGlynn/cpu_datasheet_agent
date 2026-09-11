import type { Classification, ClassificationAxis } from '../core/classification.js';
import type { PartialBuckRegulatorParameters } from '../core/buck-regulator.js';
import type { ParameterKey } from '../core/parameter-keys.js';

/**
 * The parameters a rule reads. Partial on purpose: classification runs on
 * whatever extraction has produced so far, and an axis whose parameters are
 * missing is reported rather than guessed.
 */
export type ParameterSet = PartialBuckRegulatorParameters;

/** Why an axis produced no value. */
export interface UndecidedAxis {
  readonly axis: ClassificationAxis;
  /** Parameters the rule needs that the set does not hold. */
  readonly missing: readonly ParameterKey[];
  /** Sentence naming what stopped the rule. */
  readonly reason: string;
}

export interface ClassifyResult {
  readonly classifications: readonly Classification[];
  readonly undecided: readonly UndecidedAxis[];
}
