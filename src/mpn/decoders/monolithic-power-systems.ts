import { compileDecoder, type Decoder, type PackageSpec } from '../grammar.js';

/**
 * MPS package codes as Digi-Key reports them.
 *
 * Almost every code covers several pin counts: `GRE` is a 14-, 20- and
 * 22-pin QFN across three devices in the corpus, and `GLE` is 17 pins on one
 * device and 21 on another, so only the three codes that never varied carry a
 * pin count.
 */
export const MPS_PACKAGES: readonly PackageSpec[] = [
  { code: 'DN', family: 'soic', description: 'SOIC exposed pad', pins: 8 },
  { code: 'DQ', family: 'qfn', description: 'QFN', pins: null },
  { code: 'EN', family: 'soic', description: 'SOIC exposed pad', pins: 8 },
  { code: 'GF', family: 'tssop', description: 'TSSOP exposed pad', pins: null },
  { code: 'GDE', family: 'qfn', description: 'QFN', pins: null },
  { code: 'GJ', family: 'sot23', description: 'TSOT-23', pins: 8 },
  { code: 'GL', family: 'qfn', description: 'QFN', pins: null },
  { code: 'GLE', family: 'qfn', description: 'QFN', pins: null },
  { code: 'GQ', family: 'qfn', description: 'QFN', pins: null },
  { code: 'GQBE', family: 'qfn', description: 'QFN', pins: null },
  { code: 'GRE', family: 'qfn', description: 'QFN', pins: null },
  { code: 'GRHE', family: 'qfn', description: 'QFN', pins: null },
  { code: 'GU', family: 'qfn', description: 'QFN', pins: null },
  { code: 'GV', family: 'qfn', description: 'QFN', pins: null },
  { code: 'GVE', family: 'qfn', description: 'QFN', pins: null },
];

/**
 * Monolithic Power Systems.
 *
 * The suffix reads variant letters, the package code, an option code (a fixed
 * output voltage or a configuration), `-AEC1` for an automotive part, `-LF`
 * for lead-free, and a trailing `-Z` or `-P`.
 *
 * `-Z` and `-P` are both reels and differ only in size: `-Z` is a full reel
 * of 2,500 to 5,000 parts and `-P` a 500-part reel [R-65], which is why
 * Digi-Key ships both on tape and reel. The option code is matched lazily so
 * that `-AEC1` is read as the automotive marker it is, rather than swallowed
 * as an option.
 */
export const monolithicPowerSystems: Decoder = compileDecoder({
  manufacturer: 'monolithic-power-systems',
  names: [/monolithic\s+power/i],
  forms: [
    {
      packages: MPS_PACKAGES,
      packagings: [
        { code: '-Z', packaging: 'reel' },
        { code: '-P', packaging: 'reel' },
      ],
      segments: [
        { kind: 'base', pattern: 'MPQ?\\d{3,5}' },
        { kind: 'option', pattern: '[A-Z]{0,2}', label: 'variant' },
        { kind: 'package' },
        { kind: 'option', pattern: '(?:-[A-Z0-9]{1,4})??', label: 'option' },
        { kind: 'literal', text: '-AEC1', optional: true, automotive: true },
        { kind: 'literal', text: '-LF', optional: true, leadFinish: 'lead-free' },
        { kind: 'packaging', optional: true },
      ],
    },
  ],
});
