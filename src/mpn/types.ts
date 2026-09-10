import type { PackageFamily } from '../core/classification.js';
import type { Packaging } from '../core/offer.js';

/** Manufacturers with a suffix decoder. One key per file in `decoders/`. */
export const MANUFACTURER_KEYS = [
  'texas-instruments',
  'analog-devices',
  'monolithic-power-systems',
  'diodes-incorporated',
  'onsemi',
  'richtek',
  'microchip',
  'stmicroelectronics',
] as const;
export type ManufacturerKey = (typeof MANUFACTURER_KEYS)[number];

/** What a temperature range is measured at, when the manufacturer says. */
export type TemperatureReference = 'TJ' | 'TA';

export interface TemperatureRange {
  readonly minC: number;
  readonly maxC: number;
  readonly reference: TemperatureReference | null;
}

/**
 * A temperature grade letter and the ranges it stands for.
 *
 * `range` is the operating range, which is what a distributor reports and
 * what a design has to live inside. `guaranteed` is the part of it the
 * manufacturer tests and specifies, and the two are not always the same: an
 * Analog Devices E-grade part operates from -40 °C but is only guaranteed
 * from 0 °C, with the rest assured by design [R-64]. A part chosen for a
 * -40 °C design on the strength of its operating range alone is a part whose
 * specifications nobody has promised at -40 °C.
 *
 * Both are null when the letter is recognised but no range can be claimed for
 * it, which is the case wherever a manufacturer grades by ambient temperature
 * and the distributor reports junction.
 */
export interface TemperatureGrade {
  readonly code: string;
  readonly range: TemperatureRange | null;
  readonly guaranteed: TemperatureRange | null;
}

/**
 * A package code and what it stands for.
 *
 * `family` uses the same vocabulary as the `packageFamily` classification
 * axis, so one part is described the same way whether the package came from
 * the part number or from a datasheet. It is null for a code that covers more
 * than one shape, as Richtek`s `QW` covers both WDFN and WQFN. `pins` is null
 * wherever one code covers several pin counts, which is more often than the
 * codes suggest.
 */
export interface PackageInfo {
  readonly code: string;
  readonly family: PackageFamily | null;
  readonly description: string;
  readonly pins: number | null;
}

/**
 * Everything a manufacturer's part number states about one orderable part.
 *
 * A decoder returns this or null. It never returns a partial decode: a suffix
 * holding one unrecognised character yields null, because a half-read suffix
 * is a confident wrong answer about package or temperature grade.
 */
export interface DecodedMpn {
  /** The normalised part number this was decoded from. */
  readonly mpn: string;
  readonly manufacturer: ManufacturerKey;
  /**
   * The device family: the part number with every suffix removed. One
   * datasheet usually covers one family, and this is what a distributor means
   * by a base product number.
   */
  readonly family: string;
  /**
   * The family plus every code that changes which part you receive — the
   * version letter, a fixed output voltage, a configuration option — and
   * nothing that only describes how it is shipped.
   *
   * It is a key for comparing part numbers, not a number you can order:
   * `LMR33620CQ5RNXTQ1` yields `LMR33620-C-5`. The codes are joined with a
   * hyphen because concatenating them is ambiguous — `NCV890430` with option
   * `50` and `NCV89043` with option `050` would otherwise produce the same
   * key — and the automotive marker that sits between them is carried by
   * `automotive` instead. Two part numbers with the same base part are the
   * same silicon in the same package only if their package and grade codes
   * also match.
   */
  readonly basePart: string;
  readonly package: PackageInfo | null;
  readonly temperatureGrade: TemperatureGrade | null;
  readonly packaging: Packaging;
  readonly leadFinish: string | null;
  /** Automotive qualification stated by the part number (AEC-Q100). */
  readonly automotive: boolean;
  /** Recognised codes that carry no field of their own, as `label:text`. */
  readonly extras: readonly string[];
}

/** How two part numbers from the same manufacturer relate. */
export const MPN_RELATIONS = ['exact', 'packaging_variant', 'sibling', 'unrelated'] as const;
export type MpnRelation = (typeof MPN_RELATIONS)[number];
