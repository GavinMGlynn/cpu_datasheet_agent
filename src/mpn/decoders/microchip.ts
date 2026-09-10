import { compileDecoder, type Decoder, type GradeSpec, type PackageSpec } from '../grammar.js';

/**
 * Microchip's own package codes, written after the slash.
 */
export const MICROCHIP_PACKAGES: readonly PackageSpec[] = [
  { code: 'CH', family: 'sot23', description: 'SOT-23', pins: 6 },
  { code: 'MC', family: 'dfn', description: 'DFN 2x3', pins: 8 },
  { code: 'MNY', family: 'dfn', description: 'TDFN 2x3', pins: 8 },
  { code: 'MS', family: 'msop', description: 'MSOP', pins: 8 },
  { code: 'OS', family: 'sot23', description: 'TSOT-23', pins: 5 },
  { code: 'PHA', family: 'qfn', description: 'VQFN 6x6', pins: 32 },
];

/**
 * Micrel package codes, written before the reel code.
 *
 * `ML` and `MT` carry no family. Digi-Key reports `MIC23051-16YML` as an
 * 8-lead MLF, which is a QFN, and `MIC23303YML` as a 12-lead DFN; `MT` is
 * likewise a TMLF on most devices and a TDFN on others. The code names the
 * lead frame, not the number of sides it has leads on.
 */
export const MICREL_PACKAGES: readonly PackageSpec[] = [
  { code: 'C6', family: 'other', description: 'SC-70', pins: 6 },
  { code: 'CS', family: 'other', description: 'WLCSP', pins: null },
  { code: 'D6', family: 'sot23', description: 'TSOT-23', pins: 6 },
  { code: 'FL', family: 'qfn', description: 'QFN', pins: null },
  { code: 'FT', family: 'qfn', description: 'FTQFN', pins: null },
  { code: 'JL', family: 'qfn', description: 'QFN', pins: null },
  { code: 'M', family: 'soic', description: 'SOIC', pins: 8 },
  { code: 'M6', family: 'sot23', description: 'SOT-23', pins: 6 },
  { code: 'ML', family: null, description: 'MLF (QFN) or DFN', pins: null },
  { code: 'MM', family: 'msop', description: 'MSOP', pins: 8 },
  { code: 'MT', family: null, description: 'TMLF (QFN) or TDFN', pins: null },
  { code: 'TQ', family: 'other', description: 'TQFP', pins: null },
  { code: 'TS', family: 'tssop', description: 'TSSOP', pins: null },
];

/**
 * Grade letters, recognised without a range.
 *
 * The letter alone does not fix a range in this catalogue: Digi-Key reports
 * `MCP1603-120I/MC` at −40 to 125 °C junction and `MCP1603BT-180I/OS` at −40
 * to 85 °C ambient, both grade `I`, and Micrel's `Y` covers −40 to 125 °C on
 * one family and −55 to 125 °C on another. The code is recorded so two part
 * numbers can be told apart; the range comes from the datasheet.
 */
export const MICROCHIP_GRADES: readonly GradeSpec[] = [
  { code: 'E', range: null, guaranteed: null },
  { code: 'I', range: null, guaranteed: null },
];

export const MICREL_GRADES: readonly GradeSpec[] = [
  { code: 'B', range: null, guaranteed: null },
  { code: 'Y', range: null, guaranteed: null },
  { code: 'Z', range: null, guaranteed: null },
];

/**
 * Microchip, covering its own scheme and the Micrel scheme it acquired.
 *
 * Microchip writes `<device>[variant][T]-<option><grade>/<package>[option]`,
 * where `T` before the dash means tape and reel. Micrel writes
 * `<device>[-]<option><grade><package>[-TR]`. `MIC` parts appear under both
 * schemes, so both forms are tried; only the Microchip form uses a slash, so
 * the two cannot be confused.
 */
export const microchip: Decoder = compileDecoder({
  manufacturer: 'microchip',
  names: [/^microchip/i, /^micrel/i],
  forms: [
    {
      grades: MICROCHIP_GRADES,
      packages: MICROCHIP_PACKAGES,
      segments: [
        { kind: 'base', pattern: '(?:MCP|MIC)\\d{3,5}' },
        { kind: 'option', pattern: '[A-Z]{0,2}?', label: 'variant' },
        { kind: 'literal', text: 'T', optional: true, packaging: 'reel' },
        { kind: 'literal', text: '-' },
        { kind: 'option', pattern: '[A-Z0-9.]{0,4}?', label: 'option' },
        { kind: 'grade' },
        { kind: 'literal', text: '/' },
        { kind: 'package' },
        { kind: 'option', pattern: '[A-Z]{0,4}', label: 'value-added-option', role: 'decoration' },
      ],
    },
    {
      grades: MICREL_GRADES,
      packages: MICREL_PACKAGES,
      packagings: [
        { code: '-TR', packaging: 'reel' },
        { code: '-T5', packaging: 'reel' },
      ],
      segments: [
        { kind: 'base', pattern: 'MIC\\d{3,5}' },
        { kind: 'option', pattern: '[A-Z]{0,2}?', label: 'variant' },
        { kind: 'literal', text: '-', optional: true },
        { kind: 'option', pattern: '[A-Z0-9.]{0,4}?', label: 'option' },
        { kind: 'grade' },
        { kind: 'package' },
        { kind: 'packaging', optional: true },
      ],
    },
  ],
});
