import { compileDecoder, type Decoder, type GradeSpec, type PackageSpec } from '../grammar.js';

const TJ = (minC: number, maxC: number) => ({ minC, maxC, reference: 'TJ' as const });

/**
 * Linear Technology temperature grades.
 *
 * The operating ranges are corroborated by every part in the corpus: Digi-Key
 * reports the same junction range for every part sharing a grade letter. What
 * the corpus cannot show is that `E` and `I` are not the same part twice.
 * Both operate from -40 °C to 125 °C, and Digi-Key reports both that way, but
 * an E-grade device is only guaranteed from 0 °C, with the range below that
 * assured by design rather than tested; an I-grade device is tested across
 * the whole of it [R-64]. A -40 °C design wants the I.
 */
export const LT_GRADES: readonly GradeSpec[] = [
  { code: 'E', range: TJ(-40, 125), guaranteed: TJ(0, 125) },
  { code: 'I', range: TJ(-40, 125), guaranteed: TJ(-40, 125) },
  { code: 'H', range: TJ(-40, 150), guaranteed: TJ(-40, 150) },
  { code: 'X', range: TJ(-40, 175), guaranteed: TJ(-40, 175) },
  { code: 'MP', range: TJ(-55, 150), guaranteed: TJ(-55, 150) },
];

export const LT_PACKAGES: readonly PackageSpec[] = [
  { code: 'MSE', family: 'msop', description: 'MSOP exposed pad', pins: 16 },
  { code: 'DHC', family: 'dfn', description: 'DFN 5x3', pins: 16 },
];

/** Maxim package codes. The code names the shape; the pin count is per device. */
export const MAX_PACKAGES: readonly PackageSpec[] = [
  { code: 'TP', family: 'qfn', description: 'TQFN', pins: null },
];

/**
 * Analog Devices, covering both part-numbering schemes it inherited.
 *
 * Linear Technology parts read variant, temperature grade, package, an
 * optional fixed output voltage, then `#` and the finish, where `TR` before
 * `PBF` means tape and reel and its absence means a tube. Maxim parts read
 * variant, temperature grade, package, `+` for RoHS, then `T` for tape and
 * reel, with a tray otherwise.
 */
export const analogDevices: Decoder = compileDecoder({
  manufacturer: 'analog-devices',
  names: [/analog\s+devices/i, /linear\s+technology/i, /maxim/i],
  forms: [
    {
      grades: LT_GRADES,
      packages: LT_PACKAGES,
      packagings: [{ code: 'TR', packaging: 'reel' }],
      leadFinishes: [{ code: 'PBF', finish: 'lead-free' }],
      defaultPackaging: 'tube',
      segments: [
        { kind: 'base', pattern: 'LT[CM]?\\d{4,5}' },
        { kind: 'option', pattern: '[A-Z]{0,2}', label: 'variant' },
        { kind: 'grade' },
        { kind: 'package' },
        { kind: 'option', pattern: '(?:-\\d(?:\\.\\d)?)?', label: 'output-voltage' },
        { kind: 'literal', text: '#' },
        { kind: 'literal', text: 'W', optional: true, extra: 'adi-option:W' },
        { kind: 'packaging', optional: true },
        { kind: 'leadFinish' },
      ],
    },
    {
      grades: [{ code: 'A', range: TJ(-40, 125), guaranteed: TJ(-40, 125) }],
      packages: MAX_PACKAGES,
      packagings: [{ code: 'T', packaging: 'reel' }],
      leadFinishes: [{ code: '+', finish: 'lead-free' }],
      defaultPackaging: 'tray',
      segments: [
        { kind: 'base', pattern: 'MAX\\d{4,5}' },
        { kind: 'option', pattern: '[A-Z]{0,2}', label: 'variant' },
        { kind: 'grade' },
        { kind: 'package' },
        { kind: 'leadFinish' },
        { kind: 'packaging', optional: true },
      ],
    },
  ],
});
