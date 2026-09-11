import { z } from 'zod';

import {
  Currency,
  FEATURES,
  INTEGRATIONS,
  NormalisedMpn,
  OUTPUT_TYPES,
  PACKAGE_FAMILIES,
  TEMPERATURE_GRADES,
  TOPOLOGIES,
  quantityOf,
  rangeOf,
  type Part,
  type ParameterKey,
} from '../core/index.js';
import type { ParameterValue } from '../reconcile/index.js';

/**
 * The one sentence this project exists to answer, as a schema: a part to
 * beat, what the replacement must still do, and how many you are buying.
 *
 * Every constraint is a requirement rather than a preference. A candidate
 * either covers the input range or it does not, and a ranking that let a
 * cheaper part through on "close enough" would be recommending a dead board.
 */
export const AlternateQuery = z.strictObject({
  /** The part to be replaced. It is never offered as its own alternate. */
  mpn: NormalisedMpn,
  /** The input range the alternate must cover end to end. */
  vinRange: rangeOf('V').optional(),
  /** The output current the alternate must be able to deliver. */
  ioutMin: quantityOf('A').optional(),
  topology: z.enum(TOPOLOGIES).optional(),
  /**
   * Fixed or adjustable. Not in the original constraint list, and added the
   * first time the query answered for real: a cheaper part that covers the
   * input range and the current can still have a fixed 5 V output where the
   * reference is adjustable, and that is not an alternate for most boards.
   */
  outputType: z.enum(OUTPUT_TYPES).optional(),
  integration: z.enum(INTEGRATIONS).optional(),
  packageFamily: z.enum(PACKAGE_FAMILIES).optional(),
  temperatureGrade: z.enum(TEMPERATURE_GRADES).optional(),
  /** Every one of these features must be present. */
  features: z.array(z.enum(FEATURES)).optional(),
  /** The quantity the unit price is read at. */
  quantity: z.int().positive().max(1_000_000),
  /** Prices are compared in one currency; a part with no price in it is unranked. */
  currency: Currency,
  /** Offer parts whose values no verification pass has confirmed. */
  includeUnverified: z.boolean().default(false),
  limit: z.int().positive().max(50).default(5),
});
export type AlternateQuery = z.output<typeof AlternateQuery>;

/** What a candidate costs, at the quantity asked about. */
export interface UnitPrice {
  readonly amount: number;
  readonly currency: Currency;
  /** The price break this came from, which is at most the quantity asked about. */
  readonly breakQuantity: number;
  readonly distributor: string;
  readonly sku: string;
  readonly stock: number;
}

/** One parameter, on both parts, side by side. */
export interface ParameterComparison {
  readonly key: ParameterKey;
  readonly reference: ParameterValue;
  readonly candidate: ParameterValue;
  /** Whether the two values are the same, by the same rule the evaluation scores with. */
  readonly same: boolean;
}

export interface Alternate {
  readonly part: Part;
  /** Null when no offer prices this part in the currency asked about. */
  readonly price: UnitPrice | null;
  /** How much cheaper than the reference, as a fraction. Null when either has no price. */
  readonly saving: number | null;
  readonly comparison: readonly ParameterComparison[];
  /**
   * Always this. Nothing in this system reads a pinout, and a parametric
   * match is not a drop-in replacement (`CLAUDE.md`).
   */
  readonly pinCompatibility: 'not_assessed';
}

export interface AlternateResult {
  readonly reference: Part;
  readonly referencePrice: UnitPrice | null;
  /** Cheapest first; parts with no price in the currency asked about come last. */
  readonly alternates: readonly Alternate[];
  /** Parts that met every constraint but were not offered, and why. */
  readonly excluded: readonly { readonly mpn: string; readonly reason: string }[];
  /** Printed with every answer, every time. */
  readonly disclaimer: string;
}
