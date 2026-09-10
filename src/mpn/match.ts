import { Escalation } from '../core/escalation.js';
import { parseOrThrow } from '../core/validation-error.js';
import { elementAt } from '../util/array.js';
import type { MpnCandidate } from './candidates.js';
import { decoderFor } from './decoders/index.js';
import type { DecodedMpn, ManufacturerKey, MpnRelation } from './types.js';

/** Best first, so the caller can read the answer off the top of the list. */
const RELATION_ORDER: Readonly<Record<MpnRelation, number>> = Object.freeze({
  exact: 0,
  packaging_variant: 1,
  sibling: 2,
  unrelated: 3,
});

export interface MpnMatch {
  readonly candidate: MpnCandidate;
  readonly relation: MpnRelation;
}

export interface MpnResolution {
  /** The normalised part number that was asked about. */
  readonly query: string;
  readonly decoded: DecodedMpn | null;
  /** Every candidate, best relation first. */
  readonly matches: readonly MpnMatch[];
  /** The one listing that is this part, when exactly one manufacturer lists it. */
  readonly resolved: MpnCandidate | null;
  /** Raised when the answer is not the agent's to choose. */
  readonly escalation: Escalation | null;
}

export interface ResolveDeps {
  /** Clock, injected so a resolution is reproducible in a test. */
  readonly now: () => string;
  readonly newId: () => string;
}

function sameCode(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

/**
 * How a candidate listing relates to the part number that was asked about.
 *
 * Identical part numbers are an exact match. Otherwise both must decode, from
 * the same manufacturer, before anything can be claimed: the same suffix
 * means different things to different manufacturers, so an undecoded listing
 * is unrelated rather than assumed.
 *
 * A packaging variant is the same silicon in the same package, shipped
 * differently — the base part, package code, temperature grade and automotive
 * qualification all match, and only the reel, finish or value-added codes
 * differ. A sibling shares the family but not those, which makes it a
 * different part however similar the number looks.
 */
export function relate(
  queryMpn: string,
  queryDecoded: DecodedMpn | null,
  candidate: MpnCandidate,
): MpnRelation {
  if (candidate.mpn === queryMpn) {
    return 'exact';
  }
  const decoded = candidate.decoded;
  if (queryDecoded === null || decoded === null) {
    return 'unrelated';
  }
  if (queryDecoded.manufacturer !== decoded.manufacturer) {
    return 'unrelated';
  }
  if (
    queryDecoded.basePart === decoded.basePart &&
    sameCode(queryDecoded.package?.code, decoded.package?.code) &&
    sameCode(queryDecoded.temperatureGrade?.code, decoded.temperatureGrade?.code) &&
    queryDecoded.automotive === decoded.automotive
  ) {
    return 'packaging_variant';
  }
  return queryDecoded.family === decoded.family ? 'sibling' : 'unrelated';
}

/**
 * Decodes the part number that was asked about.
 *
 * The manufacturer is not known up front, so it comes from the listings: an
 * exact match names it outright, and otherwise every manufacturer among the
 * candidates is tried. Two manufacturers whose decoders both read the number
 * leave it undecoded, because picking one would be a guess.
 */
export function decodeQuery(query: string, candidates: readonly MpnCandidate[]): DecodedMpn | null {
  const exact = candidates.find(
    (candidate) => candidate.mpn === query && candidate.decoded !== null,
  );
  if (exact?.decoded != null) {
    return exact.decoded;
  }
  const decoded = new Map<ManufacturerKey, DecodedMpn>();
  for (const manufacturer of new Set(candidates.map((candidate) => candidate.manufacturer))) {
    const result = decoderFor(manufacturer)?.decode(query);
    if (result != null) {
      decoded.set(result.manufacturer, result);
    }
  }
  const unique = [...decoded.values()];
  return unique.length === 1 ? elementAt(unique, 0) : null;
}

function optionsFor(matches: readonly MpnMatch[]): string[] {
  const options = new Set<string>();
  for (const { candidate } of matches) {
    options.add(`${candidate.mpnAsListed} — ${candidate.manufacturer} (${candidate.distributor})`);
  }
  return [...options];
}

function escalate(
  deps: ResolveDeps,
  query: string,
  question: string,
  matches: readonly MpnMatch[],
): Escalation {
  return parseOrThrow(
    Escalation,
    {
      id: deps.newId(),
      mpn: query,
      kind: 'ambiguous_mpn',
      question,
      context: {
        query,
        candidates: matches.map(({ candidate, relation }) => ({
          mpn: candidate.mpn,
          mpnAsListed: candidate.mpnAsListed,
          manufacturer: candidate.manufacturer,
          distributor: candidate.distributor,
          relation,
        })),
      },
      options: optionsFor(matches),
      createdAt: deps.now(),
    },
    `ambiguous_mpn escalation for ${query}`,
  );
}

/**
 * Decides which listing is the part, or hands the question to a person.
 *
 * Two manufacturers listing the same part number, or no exact listing and
 * several siblings to choose between, are both escalated rather than guessed:
 * a wrong resolution silently attaches one part's datasheet to another part's
 * parameters, and every value downstream inherits the mistake.
 */
export function resolveMpn(
  query: string,
  candidates: readonly MpnCandidate[],
  deps: ResolveDeps,
): MpnResolution {
  const decoded = decodeQuery(query, candidates);
  const matches = candidates
    .map((candidate) => ({ candidate, relation: relate(query, decoded, candidate) }))
    .sort((a, b) => RELATION_ORDER[a.relation] - RELATION_ORDER[b.relation]);

  const exact = matches.filter((match) => match.relation === 'exact');
  const manufacturers = new Set(
    exact.map((match) => match.candidate.manufacturer.trim().toUpperCase()),
  );
  if (manufacturers.size > 1) {
    return {
      query,
      decoded,
      matches,
      resolved: null,
      escalation: escalate(
        deps,
        query,
        `${query} is listed by ${String(manufacturers.size)} manufacturers. Which one is meant?`,
        exact,
      ),
    };
  }
  if (exact.length > 0) {
    return { query, decoded, matches, resolved: elementAt(exact, 0).candidate, escalation: null };
  }

  const siblings = matches.filter((match) => match.relation === 'sibling');
  const distinct = new Set(siblings.map((match) => match.candidate.mpn));
  if (distinct.size > 1) {
    return {
      query,
      decoded,
      matches,
      resolved: null,
      escalation: escalate(
        deps,
        query,
        `No distributor lists ${query}. ${String(distinct.size)} parts from the same family are close but differ in package or temperature grade. Which one is meant?`,
        siblings,
      ),
    };
  }
  return { query, decoded, matches, resolved: null, escalation: null };
}
