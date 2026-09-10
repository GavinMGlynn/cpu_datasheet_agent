import { compileDecoder, type Decoder, type PackageSpec } from '../grammar.js';

export const DIODES_PACKAGES: readonly PackageSpec[] = [
  { code: 'DV', family: 'dfn', description: 'V-DFN3020', pins: null },
  { code: 'SJ', family: 'qfn', description: 'V-QFN2030', pins: null },
  { code: 'WU', family: 'sot23', description: 'TSOT-26', pins: 6 },
  { code: 'Z6', family: 'other', description: 'SOT-563', pins: 6 },
  { code: 'ZV', family: 'dfn', description: 'V-DFN3020 side-wettable', pins: null },
];

/**
 * Diodes Incorporated.
 *
 * The suffix reads variant letters, `Q` for an automotive-qualified part, the
 * package code, and a reel code: `-7` for a 7-inch reel and `-13` for a
 * 13-inch one. An evaluation board's `-EVM` matches nothing here, so a board
 * is not decoded as a part.
 */
export const diodesIncorporated: Decoder = compileDecoder({
  manufacturer: 'diodes-incorporated',
  names: [/^diodes\s+incorporated$/i],
  forms: [
    {
      packages: DIODES_PACKAGES,
      packagings: [
        { code: '-7', packaging: 'reel' },
        { code: '-13', packaging: 'reel' },
      ],
      segments: [
        { kind: 'base', pattern: 'AP\\d{4,5}' },
        { kind: 'option', pattern: '[A-Z]{0,2}?', label: 'variant' },
        { kind: 'literal', text: 'Q', optional: true, automotive: true },
        { kind: 'package' },
        { kind: 'packaging', optional: true },
      ],
    },
  ],
});
