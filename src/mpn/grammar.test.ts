import { describe, expect, it } from 'vitest';

import { MpnError } from './errors.js';
import {
  alternation,
  compileDecoder,
  escapeCode,
  type DecoderForm,
  type DecoderSpec,
  type PackageSpec,
} from './grammar.js';

const PACKAGES: readonly PackageSpec[] = [
  { code: 'D', family: 'soic', description: 'SOIC', pins: 8 },
  { code: 'DDA', family: 'soic', description: 'SO PowerPAD', pins: 8 },
  { code: 'QW', family: null, description: 'WDFN or WQFN', pins: null },
];

const spec: DecoderSpec = {
  manufacturer: 'texas-instruments',
  names: [/^toy$/i],
  forms: [
    {
      packages: PACKAGES,
      grades: [
        {
          code: 'E',
          range: { minC: -40, maxC: 125, reference: 'TJ' },
          guaranteed: { minC: 0, maxC: 125, reference: 'TJ' },
        },
        { code: 'N', range: null, guaranteed: null },
      ],
      packagings: [{ code: 'R', packaging: 'reel' }],
      leadFinishes: [{ code: 'G', finish: 'lead-free' }],
      defaultPackaging: 'tube',
      segments: [
        { kind: 'base', pattern: 'TOY\\d{2}' },
        { kind: 'option', pattern: '[A-Z]?', label: 'version' },
        { kind: 'literal', text: 'Q', optional: true, automotive: true },
        { kind: 'grade' },
        { kind: 'package' },
        { kind: 'packaging', optional: true },
        { kind: 'leadFinish', optional: true },
        { kind: 'literal', text: '+', optional: true, leadFinish: 'gold', extra: 'note:plus' },
        { kind: 'option', pattern: '(?:-[ZP])?', label: 'suffix', role: 'decoration' },
      ],
    },
  ],
};

const toy = compileDecoder(spec);

describe('escapeCode', () => {
  it('escapes every character a part-number code can hold', () => {
    expect(escapeCode('LT-8610.3+A#B')).toBe('LT\\-8610\\.3\\+A\\#B');
    expect(escapeCode('ABC')).toBe('ABC');
  });
});

describe('alternation', () => {
  it('puts longer codes first, so a short code cannot eat a long one', () => {
    expect(alternation(['D', 'DDA', 'DR'])).toBe('DDA|DR|D');
  });

  it('orders codes of equal length predictably', () => {
    expect(alternation(['QW', 'DR', 'AB'])).toBe('AB|DR|QW');
  });

  it('escapes as it goes', () => {
    expect(alternation(['-7', '-13'])).toBe('\\-13|\\-7');
  });
});

describe('compileDecoder', () => {
  it('claims the manufacturer names it was given', () => {
    expect(toy.claims('Toy')).toBe(true);
    expect(toy.claims('TOY')).toBe(true);
    expect(toy.claims('Texas Instruments')).toBe(false);
  });

  it('reads every segment of a full part number', () => {
    expect(toy.decode('TOY42AQEDDAR')).toEqual({
      mpn: 'TOY42AQEDDAR',
      manufacturer: 'texas-instruments',
      family: 'TOY42',
      basePart: 'TOY42-A',
      package: { code: 'DDA', family: 'soic', description: 'SO PowerPAD', pins: 8 },
      temperatureGrade: {
        code: 'E',
        range: { minC: -40, maxC: 125, reference: 'TJ' },
        guaranteed: { minC: 0, maxC: 125, reference: 'TJ' },
      },
      packaging: 'reel',
      leadFinish: null,
      automotive: true,
      extras: [],
    });
  });

  it('falls back to the default packaging when the part number states none', () => {
    const decoded = toy.decode('TOY42ND');
    expect(decoded?.packaging).toBe('tube');
    expect(decoded?.basePart).toBe('TOY42');
    expect(decoded?.temperatureGrade).toEqual({ code: 'N', range: null, guaranteed: null });
  });

  it('reads a lead finish from its own table and from a literal', () => {
    expect(toy.decode('TOY42EDRG')?.leadFinish).toBe('lead-free');
    const plus = toy.decode('TOY42EDR+');
    expect(plus?.leadFinish).toBe('gold');
    expect(plus?.extras).toEqual(['note:plus']);
  });

  it('reads packaging from a literal, as Microchip writes tape and reel', () => {
    const withReel = compileDecoder({
      manufacturer: 'microchip',
      names: [/^reel$/],
      forms: [
        {
          packages: [{ code: 'CH', family: 'sot23', description: 'SOT-23', pins: 6 }],
          segments: [
            { kind: 'base', pattern: 'MCP\\d{5}' },
            { kind: 'literal', text: 'T', optional: true, packaging: 'reel' },
            { kind: 'literal', text: '/' },
            { kind: 'package' },
          ],
        },
      ],
    });
    expect(withReel.decode('MCP16331T/CH')?.packaging).toBe('reel');
    expect(withReel.decode('MCP16331/CH')?.packaging).toBe('unknown');
  });

  it('keeps identity options in the base part and decoration options in extras', () => {
    const decoded = toy.decode('TOY42BED-Z');
    expect(decoded?.basePart).toBe('TOY42-B');
    expect(decoded?.extras).toEqual(['suffix:-Z']);
  });

  it('reports a package family of null when the code does not decide the shape', () => {
    expect(toy.decode('TOY42EQW')?.package).toEqual({
      code: 'QW',
      family: null,
      description: 'WDFN or WQFN',
      pins: null,
    });
  });

  it('returns null rather than a partial decode', () => {
    expect(toy.decode('TOY42EXX')).toBeNull();
    expect(toy.decode('TOY42EDDAREVM')).toBeNull();
    expect(toy.decode('OTHER42ED')).toBeNull();
    expect(toy.decode('')).toBeNull();
  });

  it('tries each form in turn and uses the first that reads the whole number', () => {
    const twoForms = compileDecoder({
      manufacturer: 'analog-devices',
      names: [/^two$/],
      forms: [
        {
          packages: [{ code: 'MSE', family: 'msop', description: 'MSOP-EP', pins: 16 }],
          segments: [
            { kind: 'base', pattern: 'LT\\d{4}' },
            { kind: 'literal', text: '#' },
            { kind: 'package' },
          ],
        },
        {
          packages: [{ code: 'TP', family: 'qfn', description: 'TQFN', pins: null }],
          segments: [{ kind: 'base', pattern: 'MAX\\d{5}' }, { kind: 'package' }],
        },
      ],
    });
    expect(twoForms.decode('LT8610#MSE')?.package?.code).toBe('MSE');
    expect(twoForms.decode('MAX17503TP')?.package?.code).toBe('TP');
    expect(twoForms.decode('LT8610MSE')).toBeNull();
  });

  it('leaves an optional package, grade or finish unset when the number omits it', () => {
    const sparse = compileDecoder({
      manufacturer: 'stmicroelectronics',
      names: [/^sparse$/],
      forms: [
        {
          packages: [{ code: 'PU', family: 'dfn', description: 'DFN', pins: 8 }],
          grades: [{ code: 'I', range: null, guaranteed: null }],
          segments: [
            { kind: 'base', pattern: 'ST1S\\d{2}' },
            { kind: 'grade', optional: true },
            { kind: 'package', optional: true },
          ],
        },
      ],
    });
    expect(sparse.decode('ST1S10')).toMatchObject({
      package: null,
      temperatureGrade: null,
      packaging: 'unknown',
      leadFinish: null,
    });
    expect(sparse.decode('ST1S10IPU')).toMatchObject({
      package: { code: 'PU' },
      temperatureGrade: { code: 'I', range: null, guaranteed: null },
    });
  });

  it('refuses to compile a table segment with nothing in its table', () => {
    const missing = expect.objectContaining({ code: 'MPN_TABLE_MISSING' }) as unknown as Error;
    expect(() =>
      compileDecoder({
        manufacturer: 'richtek',
        names: [/^empty$/],
        forms: [{ segments: [{ kind: 'base', pattern: 'RT\\d{4}' }, { kind: 'package' }] }],
      }),
    ).toThrow(missing);
    expect(() =>
      compileDecoder({
        manufacturer: 'richtek',
        names: [/^empty$/],
        forms: [
          { packages: [], segments: [{ kind: 'base', pattern: 'RT\\d{4}' }, { kind: 'package' }] },
        ],
      }),
    ).toThrow(missing);
  });

  it('fails loudly when a table is emptied after the pattern was built', () => {
    // The pattern is built from the table, so this cannot happen by accident.
    // It is what a future edit that keeps two copies of the codes would do,
    // and a silently wrong package is worse than a thrown error.
    const packages: PackageSpec[] = [{ code: 'SP', family: 'soic', description: 'SOP', pins: 8 }];
    const drifting = compileDecoder({
      manufacturer: 'richtek',
      names: [/^drift$/],
      forms: [{ packages, segments: [{ kind: 'base', pattern: 'RT\\d{4}' }, { kind: 'package' }] }],
    });
    expect(drifting.decode('RT8279SP')?.package?.code).toBe('SP');
    packages.length = 0;
    expect(() => drifting.decode('RT8279SP')).toThrow(MpnError);

    // A table removed from the form altogether, rather than emptied.
    const form: DecoderForm = {
      packages: [{ code: 'SP', family: 'soic', description: 'SOP', pins: 8 }],
      segments: [{ kind: 'base', pattern: 'RT\\d{4}' }, { kind: 'package' }],
    };
    const removed = compileDecoder({
      manufacturer: 'richtek',
      names: [/^removed$/],
      forms: [form],
    });
    Reflect.deleteProperty(form, 'packages');
    expect(() => removed.decode('RT8279SP')).toThrow(
      expect.objectContaining({ code: 'MPN_TABLE_MISSING' }) as unknown,
    );
  });
});
