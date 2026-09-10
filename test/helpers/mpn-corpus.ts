import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(import.meta.dirname, '..', 'fixtures', 'mpn');

/**
 * One recorded Digi-Key listing, as `scripts/record-mpn-corpus.ts` wrote it.
 *
 * The package, packaging and temperature fields are Digi-Key's own, which is
 * the point: they are an independent reading of the part number, so a decoder
 * checked against them is not being checked against itself.
 */
export interface CorpusEntry {
  readonly mpn: string;
  readonly manufacturer: string;
  readonly baseProductNumber: string | null;
  readonly packageCase: string;
  readonly supplierPackage: string;
  readonly operatingTemperature: string;
  readonly packagings: readonly string[];
}

export function corpusFiles(): readonly string[] {
  return readdirSync(DIR)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

export function loadCorpus(file: string): readonly CorpusEntry[] {
  return JSON.parse(readFileSync(path.join(DIR, file), 'utf8')) as CorpusEntry[];
}

/**
 * Evaluation boards, demo circuits and reference designs.
 *
 * A keyword search returns them alongside the parts, and they are not parts:
 * they carry no package and no orderable suffix, so a decoder must not read
 * one as a component.
 */
const BOARD =
  /EVM|EVB|EVK|GEVB|GEVK|EVKIT|REFDES|DEMOBOARD|DEMOBO|STEVAL|^EVAL|EV$|^DC\d{4}|^ADM\d{5}|^ARD\d{5}|^BB\d|^COM-|^SPS-|^SECO-|^STR-|^NV\d/;

export function isBoard(mpn: string): boolean {
  return BOARD.test(mpn);
}

/** Digi-Key's package name mapped to the shared package-family vocabulary. */
const FAMILY_RULES: readonly (readonly [RegExp, string])[] = [
  // Checked before the SOT-23 rule: SOT-563 and SOT-583 are neither SOT-23
  // nor anything else in the vocabulary.
  [/SOT-5\d\d|DSBGA|WLCSP|FLIPCHIP|SC-70|TQFP/i, 'other'],
  [/SOT-223/i, 'sot223'],
  [/SOT-23|TSOT-26/i, 'sot23'],
  [/MSOP|VSSOP/i, 'msop'],
  [/TSSOP/i, 'tssop'],
  [/QFN|MLF|VFQFPN/i, 'qfn'],
  [/DFN|WSON|VSON|SON\b/i, 'dfn'],
  [/SOIC|SOICE|SO POWERPAD|SOP|POWERSO/i, 'soic'],
  [/TO-220/i, 'to220'],
  [/TO-263/i, 'to263'],
];

/** Null when Digi-Key's name does not map to a family in the vocabulary. */
export function familyOfPackageName(name: string): string | null {
  for (const [pattern, family] of FAMILY_RULES) {
    if (pattern.test(name)) {
      return family;
    }
  }
  return null;
}

/** The pin count Digi-Key writes in front of a package name, when it does. */
export function pinsOfPackageName(name: string): number | null {
  const leading = /^(\d{1,3})-/.exec(name);
  return leading === null ? null : Number(leading[1]);
}

export interface CorpusTemperature {
  readonly minC: number;
  readonly maxC: number;
  readonly reference: 'TJ' | 'TA' | null;
}

export function temperatureOf(text: string): CorpusTemperature | null {
  const match = /^(-?\d+)°C\s*~\s*(-?\d+)°C(?:\s*\((TJ|TA)\))?$/.exec(text);
  if (match === null) {
    return null;
  }
  const [, min, max, reference] = match;
  return {
    minC: Number(min),
    maxC: Number(max),
    reference: reference === 'TJ' || reference === 'TA' ? reference : null,
  };
}
