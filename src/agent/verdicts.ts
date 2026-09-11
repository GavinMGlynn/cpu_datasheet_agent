import {
  Escalation,
  PARAMETER_KEYS,
  parseOrThrow,
  type Part,
  type ParameterKey,
  type Verification,
} from '../core/index.js';
import { PARAMETER_POLICIES } from '../reconcile/index.js';
import { required } from '../util/present.js';

export interface VerdictClock {
  readonly now: () => string;
  readonly newId: () => string;
}

export interface VerdictOutcome {
  /** The part as the verdicts leave it. Unchanged when nothing was decided. */
  readonly part: Part;
  readonly escalations: readonly Escalation[];
  readonly confirmed: readonly ParameterKey[];
  readonly contradicted: readonly ParameterKey[];
  readonly notFound: readonly ParameterKey[];
  /** Parameters no verdict covered, and parameters no page could cover. */
  readonly unchecked: readonly ParameterKey[];
  readonly changed: boolean;
}

type Parameters = Part['parameters'];

/**
 * Writes one parameter back into the set.
 *
 * The cast is confined here, as it is in reconciliation: TypeScript cannot
 * correlate a key drawn from a union with the value type that key holds.
 */
function put(set: Parameters, key: ParameterKey, parameter: object): void {
  (set as Record<ParameterKey, unknown>)[key] = parameter;
}

/** A stored value as a question puts it back to a person. */
function describe(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Applies a pass's verdicts to the part.
 *
 * A confirmed value becomes `verified`; a contradicted one becomes `conflict`
 * and raises a question. `not_found` on a safety-relevant rating is treated as
 * a contradiction — a rating nobody can find on the page it cites is exactly
 * the case `CLAUDE.md` says must go to a person — and on anything else it
 * leaves the value as it was, checked and not confirmed.
 *
 * A value carrying a distributor conflict is never promoted, whatever the
 * page says: the disagreement is still recorded, and `Part` requires such a
 * parameter to stay in `conflict`. The verdict still counts as confirmed,
 * because it is.
 *
 * The verdicts join the part's own record of them. Storing a part replaces
 * its child rows, so a part written back without them would erase the
 * verdicts the pass had just recorded — which is what the first real run of
 * this pass did.
 */
export function applyVerdicts(
  part: Part,
  verdicts: ReadonlyMap<ParameterKey, Verification>,
  clock: VerdictClock,
): VerdictOutcome {
  const confirmed: ParameterKey[] = [];
  const contradicted: ParameterKey[] = [];
  const notFound: ParameterKey[] = [];
  const unchecked: ParameterKey[] = [];
  const escalations: Escalation[] = [];
  const parameters: Parameters = { ...part.parameters };
  let changed = false;

  const ask = (question: string, context: Record<string, unknown>): void => {
    escalations.push(
      parseOrThrow(
        Escalation,
        {
          id: clock.newId(),
          mpn: part.mpn,
          kind: 'conflict',
          question,
          context,
          createdAt: clock.now(),
        },
        'Escalation',
      ),
    );
  };

  for (const key of PARAMETER_KEYS) {
    const parameter = part.parameters[key];
    const verdict = verdicts.get(key);
    if (parameter.provenance.source !== 'datasheet' || verdict === undefined) {
      unchecked.push(key);
      continue;
    }
    const safety = PARAMETER_POLICIES[key].safety;
    const lost = verdict.verdict === 'not_found' && safety;
    if (verdict.verdict === 'confirmed') {
      confirmed.push(key);
      if (parameter.conflicts === undefined && parameter.confidence !== 'verified') {
        put(parameters, key, { ...parameter, confidence: 'verified' });
        changed = true;
      }
      continue;
    }
    if (verdict.verdict === 'not_found' && !safety) {
      notFound.push(key);
      continue;
    }
    if (lost) {
      notFound.push(key);
      ask(
        `Verification could not find ${key} on page ${String(verdict.page)}, which is where it is cited, and it is a safety-relevant rating. Where does the datasheet state it?`,
        { parameter: key, stored: describe(parameter.value), page: verdict.page },
      );
    } else {
      contradicted.push(key);
      const quote = required(verdict.quote, 'the quote on a contradicted verdict');
      ask(
        `Verification read page ${String(verdict.page)} as contradicting ${key} = ${describe(parameter.value)}. The page reads: "${quote}". Which is right?`,
        {
          parameter: key,
          stored: describe(parameter.value),
          page: verdict.page,
          quote,
        },
      );
    }
    if (parameter.confidence !== 'conflict') {
      put(parameters, key, { ...parameter, confidence: 'conflict' });
      changed = true;
    }
  }

  const confidences = PARAMETER_KEYS.map((key) => parameters[key].confidence);
  const status = confidences.every((confidence) => confidence === 'verified')
    ? 'verified'
    : confidences.includes('conflict')
      ? 'needs_human'
      : part.status;
  const next: Part = {
    ...part,
    parameters,
    verifications: [...part.verifications, ...verdicts.values()],
    status,
    updatedAt: clock.now(),
  };
  return {
    part: status === part.status && !changed ? part : next,
    escalations,
    confirmed,
    contradicted,
    notFound,
    unchecked,
    changed: changed || status !== part.status,
  };
}
