import { compileDecoder, type Decoder, type PackageSpec } from '../grammar.js';

export const ST1S_PACKAGES: readonly PackageSpec[] = [
  { code: 'PH', family: 'soic', description: 'PowerSO or HSOP', pins: 8 },
  { code: 'PU', family: 'dfn', description: 'DFN 4x4', pins: 8 },
];

export const ST1PS_PACKAGES: readonly PackageSpec[] = [
  { code: 'J', family: 'other', description: 'flip-chip', pins: 8 },
];

/**
 * STMicroelectronics.
 *
 * ST encodes little beyond the reel: the `L` series writes the variant
 * letters as part of the device name (`L7987` and `L7987L` are different
 * regulators, as are `L6986`, `L6986F` and `L6986H`), and only a trailing
 * `TR` marks tape and reel. Those letters are therefore kept in the base
 * part, so two variants are never mistaken for packagings of one part, and no
 * package is claimed for the series at all.
 *
 * The `ST1S` and `ST1PS` families do carry a package code before the reel
 * letter, so they are decoded as their own forms.
 */
export const stmicroelectronics: Decoder = compileDecoder({
  manufacturer: 'stmicroelectronics',
  names: [/^stmicroelectronics$/i],
  forms: [
    {
      packages: ST1S_PACKAGES,
      packagings: [{ code: 'R', packaging: 'reel' }],
      defaultPackaging: 'tube',
      segments: [
        { kind: 'base', pattern: 'ST1S\\d{2}' },
        { kind: 'package' },
        { kind: 'packaging', optional: true },
      ],
    },
    {
      packages: ST1PS_PACKAGES,
      packagings: [{ code: 'R', packaging: 'reel' }],
      defaultPackaging: 'tube',
      segments: [
        { kind: 'base', pattern: 'ST1PS\\d{2}[A-Z]' },
        { kind: 'package' },
        { kind: 'packaging', optional: true },
      ],
    },
    {
      packagings: [{ code: 'TR', packaging: 'reel' }],
      defaultPackaging: 'tube',
      segments: [
        { kind: 'base', pattern: 'L\\d{4}[A-Z0-9]{0,4}?' },
        { kind: 'packaging', optional: true },
      ],
    },
  ],
});
