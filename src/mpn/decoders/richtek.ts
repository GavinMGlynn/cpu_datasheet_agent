import { compileDecoder, type Decoder, type PackageSpec } from '../grammar.js';

/**
 * Richtek package codes.
 *
 * `QW` carries no family: Digi-Key reports it as a 6-lead WDFN on one device
 * and a 40-lead WQFN on another, and DFN and QFN are different shapes, so the
 * code decides neither the family nor the pin count.
 */
export const RICHTEK_PACKAGES: readonly PackageSpec[] = [
  { code: 'E', family: 'sot23', description: 'SOT-23', pins: 6 },
  { code: 'J6', family: 'sot23', description: 'TSOT-23', pins: 6 },
  { code: 'QW', family: null, description: 'WDFN or WQFN', pins: null },
  { code: 'SP', family: 'soic', description: 'SOP exposed pad', pins: 8 },
];

/**
 * Richtek.
 *
 * The suffix reads variant letters, a `G` or `Z` code, and the package code.
 * The `G` is Richtek's green-package marker; `Z` appears in the same position
 * on the same devices, so both are recorded as written rather than read as a
 * lead finish. Richtek does not encode packaging in the part number.
 */
export const richtek: Decoder = compileDecoder({
  manufacturer: 'richtek',
  names: [/^richtek/i],
  forms: [
    {
      packages: RICHTEK_PACKAGES,
      segments: [
        { kind: 'base', pattern: 'RT\\d{4}(?:-\\d{2,3})?' },
        { kind: 'option', pattern: '[A-Z]{0,3}?', label: 'variant' },
        { kind: 'option', pattern: '[GZ]?', label: 'richtek-code', role: 'decoration' },
        { kind: 'package' },
      ],
    },
  ],
});
