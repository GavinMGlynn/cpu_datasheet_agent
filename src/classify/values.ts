import type { BuckRegulatorParameters } from '../core/buck-regulator.js';
import type { ParameterKey } from '../core/parameter-keys.js';
import type { ParameterSet } from './types.js';

/** The values of the named parameters, each at its own type. */
export type Values<K extends ParameterKey> = {
  readonly [P in K]: BuckRegulatorParameters[P]['value'];
};

export type ValuesResult<K extends ParameterKey> =
  | { readonly ok: true; readonly values: Values<K> }
  | { readonly ok: false; readonly missing: readonly K[] };

/**
 * Collects the values a rule needs, or the keys the set does not hold.
 *
 * A parameter that is present but holds `null` is not missing: `null` is a
 * value the datasheet stated (an adjustable part's fixed output, a
 * non-synchronous part's low-side resistance) and the rules read it as one.
 */
export function requireValues<K extends ParameterKey>(
  parameters: ParameterSet,
  keys: readonly K[],
): ValuesResult<K> {
  const missing: K[] = [];
  const values: Partial<Record<K, unknown>> = {};
  for (const key of keys) {
    const parameter = parameters[key];
    if (parameter === undefined) {
      missing.push(key);
    } else {
      values[key] = parameter.value;
    }
  }
  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return { ok: true, values: values as Values<K> };
}
