import { compileDecoder, type Decoder, type PackageSpec } from '../grammar.js';

/**
 * TI package codes seen in the recorded corpus, with the package Digi-Key
 * reports for every part carrying the code.
 *
 * `pins` is null wherever one code covers several pin counts. The corpus
 * cannot show that on its own — a code that happens to appear on one pin
 * count looks fixed — so the counts here were checked against TI's own
 * packaging guide [R-62], which lists `D` as SOIC in 8, 14 and 16 leads,
 * `DBV` as SOT-23 in 5 and 6, and `RHL` as a 24-lead VQFN where Digi-Key
 * reports 14 for the TPS54620. All four of those, and `PWP`, therefore claim
 * no pin count. `DRL` is a 6-lead SOT-563 on one device and an 8-lead SOT-583
 * on the next.
 */
export const TI_PACKAGES: readonly PackageSpec[] = [
  { code: 'D', family: 'soic', description: 'SOIC', pins: null },
  { code: 'DDA', family: 'soic', description: 'SO PowerPAD', pins: 8 },
  { code: 'DDC', family: 'sot23', description: 'SOT-23 thin', pins: 6 },
  { code: 'DBV', family: 'sot23', description: 'SOT-23', pins: null },
  { code: 'DCN', family: 'sot23', description: 'SOT-23', pins: 8 },
  { code: 'DGK', family: 'msop', description: 'VSSOP', pins: 8 },
  { code: 'DGQ', family: 'msop', description: 'HVSSOP', pins: 10 },
  { code: 'DLC', family: 'dfn', description: 'VSON-HR', pins: 8 },
  { code: 'DMQ', family: 'dfn', description: 'VSON-HR', pins: 6 },
  { code: 'DQC', family: 'dfn', description: 'WSON', pins: 10 },
  { code: 'DRB', family: 'dfn', description: 'SON', pins: 8 },
  { code: 'DRC', family: 'dfn', description: 'VSON', pins: 10 },
  { code: 'DRL', family: 'other', description: 'SOT-563 or SOT-583', pins: null },
  { code: 'DRV', family: 'dfn', description: 'WSON', pins: 6 },
  { code: 'DSG', family: 'dfn', description: 'WSON', pins: 8 },
  { code: 'DSS', family: 'dfn', description: 'WSON', pins: 12 },
  { code: 'PWP', family: 'tssop', description: 'HTSSOP PowerPAD', pins: null },
  { code: 'RGT', family: 'qfn', description: 'VQFN', pins: 16 },
  { code: 'RHL', family: 'qfn', description: 'VQFN', pins: null },
  { code: 'RLT', family: 'dfn', description: 'VSON-HR', pins: 7 },
  { code: 'RNX', family: 'qfn', description: 'VQFN-HR', pins: 12 },
  { code: 'RPG', family: 'qfn', description: 'VQFN-HR', pins: 14 },
  { code: 'RPJ', family: 'qfn', description: 'VQFN-HR', pins: 9 },
  { code: 'RTE', family: 'qfn', description: 'WQFN', pins: 16 },
  { code: 'RTW', family: 'qfn', description: 'WQFN', pins: 24 },
  { code: 'RWW', family: 'qfn', description: 'VQFN-HR', pins: 21 },
  { code: 'RZR', family: 'qfn', description: 'WQFN-FCRLF', pins: 16 },
  { code: 'YFP', family: 'other', description: 'DSBGA', pins: null },
  { code: 'YKA', family: 'other', description: 'DSBGA', pins: 6 },
];

/**
 * Texas Instruments.
 *
 * The suffix reads device version, an automotive marker, the package code,
 * then the reel code, with `Q1` closing an automotive part number. A device
 * number of the `TPS62A01` shape (letter and digits after the family digits)
 * is part of the base, which is why the base pattern allows it: without that
 * the `A01` would be read as a version letter and a package code.
 *
 * Reel codes `R` and `T` both mean tape and reel; they differ in reel size,
 * which the `Packaging` vocabulary does not distinguish. Absent, the part
 * ships in a tube.
 *
 * The version group matches as little as it can, so that the `Q` of
 * `TPS5430QDDARQ1` is read as the automotive marker rather than as a version
 * letter. It covers the codes TI writes there without explaining them — the
 * `PA` of `LMR33620APAQRNXRQ1` as well as the plain `B` of `TPS54360B` — and
 * the digit after the marker covers the `5` of `LMR33620CQ5RNXTQ1`. All of
 * them join the base part rather than the extras, because a fixed output
 * voltage is a different part, not a different way of shipping the same one.
 */
export const texasInstruments: Decoder = compileDecoder({
  manufacturer: 'texas-instruments',
  names: [/^texas\s+instruments$/i],
  forms: [
    {
      packages: TI_PACKAGES,
      packagings: [
        { code: 'R', packaging: 'reel' },
        { code: 'T', packaging: 'reel' },
      ],
      defaultPackaging: 'tube',
      segments: [
        { kind: 'base', pattern: '[A-Z]{2,4}\\d{2,7}(?:[A-Z]\\d{1,3})?' },
        { kind: 'option', pattern: '[A-Z]{0,3}?', label: 'version' },
        { kind: 'literal', text: 'Q', optional: true, automotive: true },
        { kind: 'option', pattern: '\\d?', label: 'option' },
        { kind: 'package' },
        { kind: 'packaging', optional: true },
        { kind: 'literal', text: 'Q1', optional: true, automotive: true },
      ],
    },
  ],
});
