import { Classification } from '../core/classification.js';
import { parseOrThrow } from '../core/validation-error.js';
import { ClassifyError } from './errors.js';
import { CLASSIFICATION_RULES } from './rules.js';
import type { ClassifyResult, ParameterSet, UndecidedAxis } from './types.js';

/**
 * Runs every classification rule, reporting the axes it could not decide
 * rather than leaving them out silently.
 *
 * Each classification is validated before it is returned, so a rule producing
 * a value outside its axis is a loud failure rather than a stored one.
 */
export function tryClassify(parameters: ParameterSet): ClassifyResult {
  const classifications: Classification[] = [];
  const undecided: UndecidedAxis[] = [];
  for (const rule of CLASSIFICATION_RULES) {
    const outcome = rule.apply(parameters);
    if (outcome.kind === 'classified') {
      classifications.push(
        parseOrThrow(Classification, outcome.classification, `classification ${rule.axis}`),
      );
    } else {
      undecided.push({ axis: rule.axis, missing: outcome.missing, reason: outcome.reason });
    }
  }
  return { classifications, undecided };
}

/**
 * Every classification axis for a part, or a `ClassifyError` naming the axes
 * that could not be decided and why.
 *
 * There is no partial answer: a caller that wants what could be decided asks
 * {@link tryClassify}. `CLASSIFY_INCOMPLETE` carries `undecided` (axis, the
 * parameters it needed, and the reason) and `missing` (every parameter named,
 * de-duplicated) in its details.
 */
export function classify(parameters: ParameterSet): readonly Classification[] {
  const result = tryClassify(parameters);
  if (result.undecided.length > 0) {
    const missing = [...new Set(result.undecided.flatMap((axis) => axis.missing))];
    const lines = result.undecided.map((axis) => `${axis.axis} (${axis.reason})`);
    throw new ClassifyError('CLASSIFY_INCOMPLETE', `cannot classify: ${lines.join('; ')}`, {
      details: { undecided: result.undecided, missing },
    });
  }
  return result.classifications;
}
