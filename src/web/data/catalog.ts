import type { ClassificationAxis } from '../../core/classification.js';
import { PARAMETER_KEYS, type ParameterKey } from '../../core/parameter-keys.js';
import type { Part, PartStatus } from '../../core/part.js';
import type { Currency } from '../../core/primitives.js';
import type { Verdict } from '../../core/verification.js';
import { numericBounds } from '../../db/json.js';
import { cheapestPrice } from '../../query/pricing.js';
import type { UnitPrice } from '../../query/types.js';
import { countBy, histogram, rate, summarise, type Bucket, type Summary } from './aggregate.js';

/** Parameters shown in the catalogue table, in the order an engineer scans them. */
export const HEADLINE_KEYS: readonly ParameterKey[] = Object.freeze([
  'vinMin',
  'vinMax',
  'ioutMax',
  'switchingFrequency',
  'package',
]);

export interface VerdictCounts {
  readonly confirmed: number;
  readonly contradicted: number;
  readonly notFound: number;
  /** Stored parameters no verification run has looked at. */
  readonly unchecked: number;
}

export interface ParameterCounts {
  /** Parameters whose value is not null: what the extraction actually found. */
  readonly stated: number;
  /** Of those, how many cite a datasheet page. */
  readonly cited: number;
  readonly verified: number;
  readonly conflicted: number;
  /** Every key in the schema, so a percentage has a denominator. */
  readonly total: number;
}

export interface PartSummary {
  readonly mpn: string;
  readonly manufacturer: string;
  readonly category: string;
  readonly status: PartStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly datasheet: { readonly sha256: string; readonly url: string; readonly pageCount: number } | undefined;
  readonly parameters: ParameterCounts;
  readonly verdicts: VerdictCounts;
  readonly classifications: Readonly<Partial<Record<ClassificationAxis, unknown>>>;
  readonly offerCount: number;
  readonly distributors: readonly string[];
  readonly stock: number;
  readonly bestPrice: UnitPrice | null;
  /** The values the table shows, raw, for the client to format. */
  readonly headline: Readonly<Partial<Record<ParameterKey, unknown>>>;
}

export interface PricingContext {
  readonly quantity: number;
  readonly currency: Currency;
}

export const DEFAULT_PRICING: PricingContext = Object.freeze({ quantity: 1, currency: 'AUD' });

function countParameters(part: Part): ParameterCounts {
  let stated = 0;
  let cited = 0;
  let verified = 0;
  let conflicted = 0;
  for (const key of PARAMETER_KEYS) {
    const parameter = part.parameters[key];
    if (parameter.value !== null) {
      stated += 1;
    }
    if (parameter.provenance.source === 'datasheet') {
      cited += 1;
    }
    if (parameter.confidence === 'verified') {
      verified += 1;
    }
    if (parameter.confidence === 'conflict') {
      conflicted += 1;
    }
  }
  return { stated, cited, verified, conflicted, total: PARAMETER_KEYS.length };
}

/**
 * The verdicts for a part, counting the parameters nothing has checked.
 *
 * Only the most recent verdict per parameter counts. A part checked twice
 * would otherwise look as though it had been checked twice as thoroughly.
 */
export function verdictCounts(part: Part): VerdictCounts {
  const latest = new Map<ParameterKey, { verdict: Verdict; checkedAt: string }>();
  for (const verification of part.verifications) {
    const held = latest.get(verification.parameterKey);
    if (held === undefined || held.checkedAt <= verification.checkedAt) {
      latest.set(verification.parameterKey, {
        verdict: verification.verdict,
        checkedAt: verification.checkedAt,
      });
    }
  }
  let confirmed = 0;
  let contradicted = 0;
  let notFound = 0;
  for (const { verdict } of latest.values()) {
    if (verdict === 'confirmed') {
      confirmed += 1;
    } else if (verdict === 'contradicted') {
      contradicted += 1;
    } else {
      notFound += 1;
    }
  }
  return {
    confirmed,
    contradicted,
    notFound,
    unchecked: PARAMETER_KEYS.length - latest.size,
  };
}

export function summarisePart(part: Part, pricing: PricingContext = DEFAULT_PRICING): PartSummary {
  const classifications: Partial<Record<ClassificationAxis, unknown>> = {};
  for (const classification of part.classifications) {
    classifications[classification.axis] = classification.value;
  }
  const headline: Partial<Record<ParameterKey, unknown>> = {};
  for (const key of HEADLINE_KEYS) {
    headline[key] = part.parameters[key].value;
  }
  return {
    mpn: part.mpn,
    manufacturer: part.manufacturer,
    category: part.category,
    status: part.status,
    createdAt: part.createdAt,
    updatedAt: part.updatedAt,
    datasheet:
      part.datasheet === undefined
        ? undefined
        : {
            sha256: part.datasheet.sha256,
            url: part.datasheet.url,
            pageCount: part.datasheet.pageCount,
          },
    parameters: countParameters(part),
    verdicts: verdictCounts(part),
    classifications,
    offerCount: part.offers.length,
    distributors: [...new Set(part.offers.map((offer) => offer.distributor))].sort(),
    stock: part.offers.reduce((total, offer) => total + offer.stock, 0),
    bestPrice: cheapestPrice(part.offers, pricing.quantity, pricing.currency),
    headline,
  };
}

export function summariseParts(
  parts: readonly Part[],
  pricing: PricingContext = DEFAULT_PRICING,
): PartSummary[] {
  return parts.map((part) => summarisePart(part, pricing));
}

export interface CoverageCell {
  readonly key: ParameterKey;
  /** Parts where this parameter has a value. */
  readonly stated: number;
  readonly cited: number;
  readonly verified: number;
  readonly conflicted: number;
  readonly contradicted: number;
  readonly parts: number;
  /** Stated as a share of parts, which is the number the heat map colours by. */
  readonly coverage: number;
}

/**
 * The parameters-by-parts matrix.
 *
 * This is the view that answers "what does the pipeline reliably find?" —
 * `maxDutyCycle` stated for five parts of fourteen is a prompt problem, and
 * it is invisible one part at a time.
 */
export function parameterCoverage(parts: readonly Part[]): CoverageCell[] {
  return PARAMETER_KEYS.map((key) => {
    let stated = 0;
    let cited = 0;
    let verified = 0;
    let conflicted = 0;
    let contradicted = 0;
    for (const part of parts) {
      const parameter = part.parameters[key];
      if (parameter.value !== null) {
        stated += 1;
      }
      if (parameter.provenance.source === 'datasheet') {
        cited += 1;
      }
      if (parameter.confidence === 'verified') {
        verified += 1;
      }
      if (parameter.confidence === 'conflict') {
        conflicted += 1;
      }
      const latest = part.verifications
        .filter((verification) => verification.parameterKey === key)
        .sort((a, b) => a.checkedAt.localeCompare(b.checkedAt))
        .at(-1);
      if (latest?.verdict === 'contradicted') {
        contradicted += 1;
      }
    }
    return {
      key,
      stated,
      cited,
      verified,
      conflicted,
      contradicted,
      parts: parts.length,
      coverage: rate(stated, parts.length),
    };
  });
}

export interface ParameterPoint {
  readonly mpn: string;
  readonly min: number | undefined;
  readonly max: number | undefined;
  readonly unit: string;
}

/** Every numeric reading of one parameter across parts, for a distribution. */
export function parameterPoints(parts: readonly Part[], key: ParameterKey): ParameterPoint[] {
  const points: ParameterPoint[] = [];
  for (const part of parts) {
    const bounds = numericBounds(part.parameters[key].value);
    if (bounds === undefined) {
      continue;
    }
    points.push({ mpn: part.mpn, min: bounds.min, max: bounds.max, unit: bounds.unit });
  }
  return points;
}

export interface Distribution {
  readonly key: ParameterKey;
  readonly unit: string | undefined;
  readonly points: readonly ParameterPoint[];
  readonly summary: Summary | undefined;
  readonly buckets: readonly Bucket[];
  /** Parts whose value for this parameter is not a number at all. */
  readonly nonNumeric: number;
}

/**
 * A distribution over one parameter.
 *
 * A one-sided bound contributes the end it states. A range contributes its
 * maximum, because the question a distribution answers here — how high does
 * this part go — is about the end that limits a design.
 */
export function parameterDistribution(
  parts: readonly Part[],
  key: ParameterKey,
  buckets = 10,
): Distribution {
  const points = parameterPoints(parts, key);
  const values = points
    .map((point) => point.max ?? point.min)
    .filter((value): value is number => value !== undefined);
  return {
    key,
    unit: points[0]?.unit,
    points,
    summary: summarise(values),
    buckets: histogram(values, { buckets }),
    nonNumeric: parts.length - points.length,
  };
}

export interface CatalogTotals {
  readonly parts: number;
  readonly parametersStated: number;
  readonly parametersCited: number;
  readonly offers: number;
  readonly datasheets: number;
  readonly byStatus: Readonly<Record<string, number>>;
  readonly byManufacturer: Readonly<Record<string, number>>;
  readonly byCategory: Readonly<Record<string, number>>;
}

function record(counts: Map<string, number>): Readonly<Record<string, number>> {
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export function catalogTotals(parts: readonly Part[]): CatalogTotals {
  let stated = 0;
  let cited = 0;
  let offers = 0;
  const datasheets = new Set<string>();
  for (const part of parts) {
    const counts = countParameters(part);
    stated += counts.stated;
    cited += counts.cited;
    offers += part.offers.length;
    if (part.datasheet !== undefined) {
      datasheets.add(part.datasheet.sha256);
    }
  }
  return {
    parts: parts.length,
    parametersStated: stated,
    parametersCited: cited,
    offers,
    datasheets: datasheets.size,
    byStatus: record(countBy(parts, (part) => part.status)),
    byManufacturer: record(countBy(parts, (part) => part.manufacturer)),
    byCategory: record(countBy(parts, (part) => part.category)),
  };
}
