import { compileDecoder, type Decoder, type PackageSpec } from '../grammar.js';

/**
 * onsemi package codes.
 *
 * `MW` carries no family: Digi-Key reports it as an 8-, 10- and 12-lead DFN
 * across the NCV890 family and as a 24-lead QFNW on the NCV891930, so the
 * code does not decide the shape.
 */
export const ONSEMI_PACKAGES: readonly PackageSpec[] = [
  { code: 'D', family: 'soic', description: 'SOIC', pins: 8 },
  { code: 'DM', family: 'msop', description: 'MSOP', pins: 8 },
  { code: 'FC', family: 'other', description: 'WLCSP', pins: null },
  { code: 'MN', family: 'dfn', description: 'DFN', pins: null },
  { code: 'MW', family: null, description: 'DFN or QFN wettable-flank', pins: null },
  { code: 'PD', family: 'soic', description: 'SOIC exposed pad', pins: 8 },
];

/**
 * onsemi.
 *
 * The suffix reads a variant letter, the package code, an optional fixed
 * output voltage (`50` for 5.0 V, `330` for 3.3 V, `ADJ` for adjustable), a
 * reel code, and `G` for a lead-free finish. Every reel code here means tape
 * and reel; they differ only in quantity.
 *
 * The variant letter matches as little as it can: read greedily it would
 * take the `P` of `NCV890200PDR2G` and leave `D`, putting a SOIC part with an
 * exposed pad in a plain SOIC.
 *
 * The `NCV` prefix is left as part of the base rather than read as an
 * automotive marker: the corpus shows every `NCV` part rated to 150 °C, but a
 * temperature rating is not a qualification, and `ask_human` is the right
 * answer for a safety claim the part number only implies.
 */
export const onsemi: Decoder = compileDecoder({
  manufacturer: 'onsemi',
  names: [/^onsemi$/i, /on\s+semiconductor/i],
  forms: [
    {
      packages: ONSEMI_PACKAGES,
      packagings: [
        { code: 'CT1', packaging: 'reel' },
        { code: 'R2', packaging: 'reel' },
        { code: 'T1', packaging: 'reel' },
        { code: 'T2', packaging: 'reel' },
        { code: 'TW', packaging: 'reel' },
        { code: 'TX', packaging: 'reel' },
      ],
      leadFinishes: [{ code: 'G', finish: 'lead-free' }],
      segments: [
        { kind: 'base', pattern: 'NC[PV]\\d{4,6}' },
        { kind: 'option', pattern: '[A-Z]??', label: 'variant' },
        { kind: 'package' },
        { kind: 'option', pattern: '(?:ADJ|\\d{2,3}[A-Z]?)?', label: 'output-voltage' },
        { kind: 'packaging' },
        { kind: 'leadFinish' },
      ],
    },
  ],
});
