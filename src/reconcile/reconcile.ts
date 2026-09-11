import { Escalation } from '../core/escalation.js';
import { ParameterConflict } from '../core/observation.js';
import { PARAMETER_KEYS, type ParameterKey } from '../core/parameter-keys.js';
import { parseOrThrow } from '../core/validation-error.js';
import {
  compareObservation,
  describeExtracted,
  describeObserved,
  type Comparison,
} from './compare.js';
import { PARAMETER_POLICIES } from './policy.js';
import type { DistributorParametrics, Observation, ParameterSet } from './types.js';

export const RECONCILE_OUTCOMES = [
  'agree',
  'conflict',
  'datasheet_only',
  'distributor_only',
] as const;
export type ReconcileOutcome = (typeof RECONCILE_OUTCOMES)[number];

export type ComparedObservation = Observation & Comparison;

export interface ReconciledParameter {
  readonly key: ParameterKey;
  readonly outcome: ReconcileOutcome;
  /** A conflict here escalated rather than being recorded and moved past. */
  readonly safety: boolean;
  /** Every distributor fact keyed to this parameter. */
  readonly observations: readonly Observation[];
  /** The verdict for each fact a comparison was attempted on. */
  readonly comparisons: readonly ComparedObservation[];
}

export interface ReconcileInput {
  /** The part being reconciled, named on any escalation raised. */
  readonly mpn: string;
  readonly parameters: ParameterSet;
  readonly sources: readonly DistributorParametrics[];
}

export interface ReconcileDeps {
  /** Clock, injected so a run is reproducible in a test. */
  readonly now: () => string;
  readonly newId: () => string;
}

export interface ReconcileResult {
  /** One entry per parameter either side stated, in schema order. */
  readonly parameters: readonly ReconciledParameter[];
  /** The input parameters with conflicts recorded and confidence updated. */
  readonly updated: ParameterSet;
  /** One per conflicting safety parameter. */
  readonly escalations: readonly Escalation[];
}

/**
 * Whether the datasheet stated this parameter.
 *
 * A `null` value means the datasheet does not state it, with one exception:
 * `voutFixed` is `null` for an adjustable part, which is a statement about
 * the part rather than silence about it.
 */
function stated(key: ParameterKey, parameters: ParameterSet): boolean {
  const parameter = parameters[key];
  if (parameter === undefined) {
    return false;
  }
  return parameter.value !== null || key === 'voutFixed';
}

function observationsFor(
  key: ParameterKey,
  sources: readonly DistributorParametrics[],
): readonly Observation[] {
  const found: Observation[] = [];
  for (const source of sources) {
    for (const fact of source.facts) {
      if (fact.key === key) {
        const { key: _key, ...observed } = fact;
        found.push({ observed, provenance: source.provenance });
      }
    }
  }
  return found;
}

function outcomeOf(
  key: ParameterKey,
  hasValue: boolean,
  comparisons: readonly ComparedObservation[],
): ReconcileOutcome {
  if (!hasValue) {
    return 'distributor_only';
  }
  const agreed = comparisons.some((comparison) => comparison.verdict === 'agree');
  const conflicted = comparisons.some((comparison) => comparison.verdict === 'conflict');
  if (conflicted && !(agreed && PARAMETER_POLICIES[key].corroboration === 'any')) {
    return 'conflict';
  }
  if (agreed) {
    return 'agree';
  }
  // Either nothing was published, or everything published was incomparable.
  // Both mean the same thing: no distributor said anything that bears on the
  // value, and the observations are reported so the reader can see which.
  return 'datasheet_only';
}

/**
 * Writes one parameter back into the set.
 *
 * The cast is confined to this function. TypeScript cannot correlate a key
 * drawn from a union with the value type that key holds, so a write through a
 * `ParameterKey` variable needs one even where the value is the very
 * parameter that key was read from.
 */
function put(set: ParameterSet, key: ParameterKey, parameter: object): void {
  (set as Record<ParameterKey, unknown>)[key] = parameter;
}

function escalationFor(
  input: ReconcileInput,
  deps: ReconcileDeps,
  parameter: ReconciledParameter,
  extracted: string,
  page: number | undefined,
): Escalation {
  const conflicting = parameter.comparisons.filter(
    (comparison) => comparison.verdict === 'conflict',
  );
  const stating = conflicting
    .map(
      (comparison) =>
        `${comparison.provenance.distributor} ${comparison.provenance.sku} says ${describeObserved(comparison.observed)}`,
    )
    .join(', ');
  const cited = page === undefined ? '' : ` (page ${String(page)})`;
  return parseOrThrow(
    Escalation,
    {
      id: deps.newId(),
      mpn: input.mpn,
      kind: 'conflict',
      question: `${input.mpn} ${parameter.key}: the datasheet says ${extracted}${cited} and ${stating}. Which is correct?`,
      context: {
        parameter: parameter.key,
        datasheet: extracted,
        ...(page === undefined ? {} : { page }),
        observations: conflicting.map((comparison) => ({
          distributor: comparison.provenance.distributor,
          sku: comparison.provenance.sku,
          observed: comparison.observed,
          rule: comparison.rule,
        })),
      },
      options: [
        `datasheet: ${extracted}${cited}`,
        ...conflicting.map(
          (comparison) =>
            `${comparison.provenance.distributor} ${comparison.provenance.sku}: ${describeObserved(comparison.observed)}`,
        ),
      ],
      createdAt: deps.now(),
    },
    `escalation for ${parameter.key}`,
  );
}

/**
 * Compares extracted parameters with distributor parametrics.
 *
 * Every parameter either side stated gets an outcome: `agree`, `conflict`,
 * `datasheet_only` (the distributor published nothing that bears on it), or
 * `distributor_only` (the datasheet did not state it). A parameter the
 * distributor published something incomparable for — a package text naming no
 * family — is `datasheet_only` with the observation recorded, because an
 * observation nobody could compare corroborates nothing.
 *
 * A conflict keeps the datasheet's value and records the distributor's
 * alongside it, with confidence `conflict`, which by the `Part` schema puts
 * the part out of `verified`. A conflict on a safety parameter
 * ({@link SAFETY_PARAMETERS}) additionally raises an `Escalation`: those are
 * never resolved by a rule.
 *
 * Nothing is adopted from a distributor. A `distributor_only` fact is
 * reported for the agent to act on, not written into the parameter set: a
 * value with no page behind it is not an extracted value.
 */
export function reconcile(input: ReconcileInput, deps: ReconcileDeps): ReconcileResult {
  const parameters: ReconciledParameter[] = [];
  const escalations: Escalation[] = [];
  const updated: ParameterSet = { ...input.parameters };

  for (const key of PARAMETER_KEYS) {
    const observations = observationsFor(key, input.sources);
    const hasValue = stated(key, input.parameters);
    if (!hasValue && observations.length === 0) {
      continue;
    }
    const policy = PARAMETER_POLICIES[key];
    const parameter = input.parameters[key];
    const comparisons: ComparedObservation[] =
      parameter === undefined || !hasValue
        ? []
        : observations.map((observation) => ({
            ...observation,
            ...compareObservation(key, parameter.value, observation.observed, policy),
          }));
    const outcome = outcomeOf(key, hasValue, comparisons);
    const reconciled: ReconciledParameter = {
      key,
      outcome,
      safety: policy.safety,
      observations,
      comparisons,
    };
    parameters.push(reconciled);

    if (outcome !== 'conflict' || parameter === undefined) {
      continue;
    }
    const conflicts = comparisons
      .filter((comparison) => comparison.verdict === 'conflict')
      .map((comparison) =>
        parseOrThrow(
          ParameterConflict,
          {
            observed: comparison.observed,
            provenance: comparison.provenance,
            rule: comparison.rule,
          },
          `conflict on ${key}`,
        ),
      );
    put(updated, key, { ...parameter, confidence: 'conflict', conflicts });
    if (policy.safety) {
      const page =
        parameter.provenance.source === 'datasheet' ? parameter.provenance.page : undefined;
      escalations.push(
        escalationFor(input, deps, reconciled, describeExtracted(parameter.value), page),
      );
    }
  }

  return { parameters, updated, escalations };
}
