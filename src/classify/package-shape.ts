import type { PackageFamily } from '../core/classification.js';
import { normaliseText } from '../units/index.js';

export interface PackageShape {
  /** The text the shape was read from, normalised. */
  readonly text: string;
  /**
   * The shape family, or null when the text names none, or names two that
   * disagree. `other` is a decision — a package outside the vocabulary, such
   * as a BGA — and null is the absence of one.
   */
  readonly family: PackageFamily | null;
  /** Lead count, or null when the text does not state one. */
  readonly pins: number | null;
}

/**
 * Body widths as Digi-Key writes them, which decide the family when the names
 * do not. `8-TSSOP, 8-MSOP (0.118", 3.00mm Width)` names both families; the
 * width says which one it is, and Digi-Key's own supplier package for those
 * listings says MSOP. The three widths here are the ones the recorded corpus
 * shows; another width falls through to the names.
 */
const BODY_WIDTHS: readonly (readonly [RegExp, PackageFamily])[] = [
  [/\b3\.00\s*MM\s+WIDTH\b/, 'msop'],
  [/\b4\.40\s*MM\s+WIDTH\b/, 'tssop'],
  [/\b3\.90\s*MM\s+WIDTH\b/, 'soic'],
];

/**
 * Package names and the family each states, checked in no particular order:
 * every rule that matches is collected, and a text naming two families
 * decides nothing. `MLF` and its variants deliberately have no rule — the
 * brand covers both QFN and DFN parts, so it names no shape on its own.
 */
const NAMES: readonly (readonly [RegExp, PackageFamily])[] = [
  [/\bSOT-?223\b/, 'sot223'],
  [/\b[A-Z]*SOT-?23\b/, 'sot23'],
  [/\b[A-Z]*SOT-?2[5-8]\b/, 'sot23'],
  // Two more names for the 5-lead SOT-23. Digi-Key's supplier field calls
  // `SC-74A, SOT-753` a SOT-23-5, and the TI decoder reads the same part's
  // `DBV` suffix as SOT-23.
  [/\bSOT-?753\b/, 'sot23'],
  [/\bSC-?74A\b/, 'sot23'],
  [/\b[A-Z]*VSSOP\b/, 'msop'],
  [/\b[A-Z]*MSOP\b/, 'msop'],
  [/\b[A-Z]*TFSOP\b/, 'msop'],
  [/\b[A-Z]*TSSOP\b/, 'tssop'],
  [/\b[A-Z]*SOIC[A-Z]*\b/, 'soic'],
  [/\bH?SOP(?:-EP)?\b/, 'soic'],
  // ST's name for an exposed-pad SOIC: Digi-Key lists `PowerSO-8` against a
  // `Package / Case` of `8-SOIC (0.154", 3.90mm Width) Exposed Pad`.
  [/\bPOWERSO\b/, 'soic'],
  [/\bSO(?:-EP)?\b/, 'soic'],
  [/\b[A-Z]*QFN/, 'qfn'],
  [/\bVFQFPN\b/, 'qfn'],
  [/\b[A-Z]*DFN/, 'dfn'],
  [/\b[A-Z]*SON\b/, 'dfn'],
  [/\bTO-?220\b/, 'to220'],
  [/\bTO-?263\b/, 'to263'],
  // Recognised shapes the vocabulary has no bucket for. Naming them is what
  // separates "outside the vocabulary" from "unreadable".
  [/\b[A-Z]*BGA\b/, 'other'],
  [/\bWLCSP\b/, 'other'],
  [/\bFLIPCHIP\b/, 'other'],
  [/\bTQFP\b/, 'other'],
  [/\bPLCC\b/, 'other'],
  [/\bSOT-?(?:363|563|583|666)\b/, 'other'],
  [/\bSC-?(?:70|88)\b/, 'other'],
];

const EXPLICIT_LEADS = /\b(\d{1,3})\s*LEADS?\b/;
const LEADING_COUNT = /^(\d{1,3})-/;
/** `SOT-23-6`, `TSOT-23-5`: the lead count follows the family. */
const SOT23_LEADS = /\b[A-Z]*SOT-?23-(\d{1,2})\b/;
/** `TSOT-26`, `SOT-25`: the last digit is the lead count. */
const SOT2X_LEADS = /\b[A-Z]*SOT-?2([5-8])\b/;
/**
 * `SOIC-8`, `TSSOP-14`, `PowerSO-8`: the count follows the family name, as
 * datasheets write it. `SOT` and `SC` names are excluded because their
 * trailing number is part of the name — `SOT-223` is not a 223-lead package.
 */
const TRAILING_COUNT = /\b(?!SOT\b|SC\b)[A-Z]{3,}-(\d{1,3})\b/;

const MIN_PINS = 2;
const MAX_PINS = 256;

function pinsFrom(text: string): number | null {
  for (const pattern of [EXPLICIT_LEADS, LEADING_COUNT, SOT23_LEADS, SOT2X_LEADS, TRAILING_COUNT]) {
    const match = pattern.exec(text);
    if (match !== null) {
      const pins = Number(match[1]);
      return pins >= MIN_PINS && pins <= MAX_PINS ? pins : null;
    }
  }
  return null;
}

function familyFrom(text: string): PackageFamily | null {
  for (const [pattern, family] of BODY_WIDTHS) {
    if (pattern.test(text)) {
      return family;
    }
  }
  const named = new Set<PackageFamily>();
  for (const [pattern, family] of NAMES) {
    if (pattern.test(text)) {
      named.add(family);
    }
  }
  const [only] = named;
  return named.size === 1 && only !== undefined ? only : null;
}

/**
 * Reads a package description — a datasheet's, a distributor's `Package /
 * Case`, or a `Supplier Device Package` — into a shape family and a lead
 * count.
 *
 * Claims nothing it cannot read: a text naming two families, or none, gives
 * `family: null`, and a text stating no lead count gives `pins: null`. Blank
 * text is read as an empty shape rather than rejected, because a distributor
 * leaving the field empty is a fact about the listing, not an error.
 */
export function parsePackage(raw: string): PackageShape {
  const text = normaliseText(raw).toUpperCase();
  return { text, family: familyFrom(text), pins: pinsFrom(text) };
}
