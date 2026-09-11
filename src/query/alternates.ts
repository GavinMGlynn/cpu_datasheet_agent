import { PARAMETER_KEYS, type ParameterKey, type Part, type PartStatus } from '../core/index.js';
import type { ClassificationFilter, ParameterFilter, Repositories } from '../db/index.js';
import { sameValue } from '../eval/scorer.js';
import { ChipAgentError } from '../errors.js';
import { cheapestPrice } from './pricing.js';
import type { Alternate, AlternateQuery, AlternateResult, ParameterComparison } from './types.js';

export class QueryError extends ChipAgentError {}

/**
 * Said with every answer, in the answer.
 *
 * This is the gotcha `CLAUDE.md` names: parametric similarity does not imply
 * pin compatibility. Nothing here reads a pinout, so nothing here can tell
 * you a part drops in. A caller that wants to skip the sentence has to delete
 * it, which is the point.
 */
export const DISCLAIMER =
  'Parametric similarity is not pin compatibility. These parts meet the constraints asked for; nothing here has compared pinouts, footprints, control loops or reference designs. Check the pinout and the application circuit before substituting.';

/** Statuses an alternate may be offered from. */
const OFFERABLE: readonly PartStatus[] = ['verified', 'extracted'];

function filtersFor(query: AlternateQuery): {
  classifications: ClassificationFilter[];
  parameters: ParameterFilter[];
} {
  const classifications: ClassificationFilter[] = [];
  const parameters: ParameterFilter[] = [];
  if (query.vinRange !== undefined) {
    // Cover the range end to end: start at or below its bottom, reach at or
    // above its top. A part that covers most of it covers none of it.
    parameters.push({ key: 'vinMin', max: query.vinRange.min });
    parameters.push({ key: 'vinMax', min: query.vinRange.max });
  }
  if (query.ioutMin !== undefined) {
    parameters.push({ key: 'ioutMax', min: query.ioutMin.value });
  }
  if (query.topology !== undefined) {
    classifications.push({ axis: 'topology', value: query.topology });
  }
  if (query.integration !== undefined) {
    classifications.push({ axis: 'integration', value: query.integration });
  }
  if (query.outputType !== undefined) {
    classifications.push({ axis: 'outputType', value: query.outputType });
  }
  if (query.packageFamily !== undefined) {
    classifications.push({ axis: 'packageFamily', value: query.packageFamily });
  }
  if (query.temperatureGrade !== undefined) {
    classifications.push({ axis: 'temperatureGrade', value: query.temperatureGrade });
  }
  for (const feature of query.features ?? []) {
    classifications.push({ axis: 'features', value: feature });
  }
  return { classifications, parameters };
}

function compare(reference: Part, candidate: Part): ParameterComparison[] {
  return PARAMETER_KEYS.map((key: ParameterKey) => {
    const mine = reference.parameters[key].value;
    const theirs = candidate.parameters[key].value;
    return { key, reference: mine, candidate: theirs, same: sameValue(key, mine, theirs) };
  });
}

/**
 * Cheaper parts that still do the job.
 *
 * Every constraint filters; price only ranks. A part with no price in the
 * currency asked about is still offered — it meets the constraints — but it
 * sorts last, because "cheaper" is not something we know about it.
 *
 * A part whose values no verification pass has confirmed is left out unless
 * the caller asks for it: recommending a replacement on the strength of an
 * unchecked reading is how a wrong absolute maximum reaches a board. Parts
 * that need a person, or were rejected, are never offered at all.
 */
export function findAlternates(repositories: Repositories, query: AlternateQuery): AlternateResult {
  const reference = repositories.parts.getPart(query.mpn);
  if (reference === undefined) {
    throw new QueryError(
      'QUERY_PART_NOT_STORED',
      `no stored part ${query.mpn} to find an alternate for`,
      {
        details: { mpn: query.mpn },
      },
    );
  }
  const { classifications, parameters } = filtersFor(query);
  const found = repositories.parts.findParts({
    category: reference.category,
    ...(classifications.length === 0 ? {} : { classifications }),
    ...(parameters.length === 0 ? {} : { parameters }),
  });

  const referencePrice = cheapestPrice(reference.offers, query.quantity, query.currency);
  const excluded: { mpn: string; reason: string }[] = [];
  const alternates: Alternate[] = [];
  for (const candidate of found) {
    if (candidate.mpn === query.mpn) {
      continue;
    }
    if (!OFFERABLE.includes(candidate.status)) {
      excluded.push({ mpn: candidate.mpn, reason: `status ${candidate.status}` });
      continue;
    }
    if (candidate.status !== 'verified' && !query.includeUnverified) {
      excluded.push({ mpn: candidate.mpn, reason: 'not verified' });
      continue;
    }
    const price = cheapestPrice(candidate.offers, query.quantity, query.currency);
    alternates.push({
      part: candidate,
      price,
      saving:
        price === null || referencePrice === null
          ? null
          : (referencePrice.amount - price.amount) / referencePrice.amount,
      comparison: compare(reference, candidate),
      pinCompatibility: 'not_assessed',
    });
  }

  // A part with no price in this currency sorts as dearer than any price:
  // it met the constraints, and "cheaper" is not something we know about it.
  const rank = (alternate: Alternate): number =>
    alternate.price?.amount ?? Number.POSITIVE_INFINITY;
  alternates.sort((one, other) =>
    rank(one) === rank(other)
      ? one.part.mpn.localeCompare(other.part.mpn)
      : rank(one) - rank(other),
  );

  return {
    reference,
    referencePrice,
    alternates: alternates.slice(0, query.limit),
    excluded,
    disclaimer: DISCLAIMER,
  };
}
