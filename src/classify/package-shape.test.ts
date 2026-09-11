import { describe, expect, it } from 'vitest';

import { parsePackage } from './package-shape.js';

describe('parsePackage families', () => {
  it.each([
    ['SOT-23-6', 'sot23'],
    ['SOT-23-6 Thin, TSOT-23-6', 'sot23'],
    ['TSOT-26', 'sot23'],
    ['SOT-23-THIN', 'sot23'],
    ['SC-74A, SOT-753', 'sot23'],
    ['SOT-223-4', 'sot223'],
    ['8-SOIC (0.154", 3.90mm Width)', 'soic'],
    ['8-PowerSOIC (0.154", 3.90mm Width)', 'soic'],
    ['8-SOICE', 'soic'],
    ['8-SO PowerPad', 'soic'],
    ['8-HSOP-EP', 'soic'],
    ['PowerSO-8', 'soic'],
    ['16-MSOP-EP', 'msop'],
    ['10-HVSSOP', 'msop'],
    ['16-TFSOP (0.118", 3.00mm Width) Exposed Pad', 'msop'],
    ['16-PowerTSSOP (0.173", 4.40mm Width)', 'tssop'],
    ['24-TSSOP', 'tssop'],
    ['12-PowerVFQFN', 'qfn'],
    ['24-QFNW (4x4)', 'qfn'],
    ['8-VFQFPN (3x3)', 'qfn'],
    ['V-QFN2030-12 (Type A)', 'qfn'],
    ['10-VFDFN Exposed Pad', 'dfn'],
    ['8-WSON (2x2)', 'dfn'],
    ['V-DFN3020-13 (Type A)', 'dfn'],
    ['TO-220-5', 'to220'],
    ['TO-263-7, D²PAK', 'to263'],
    ['20-UFBGA, WLCSP', 'other'],
    ['48-TQFP (7x7)', 'other'],
    ['2-PLCC', 'other'],
    ['SOT-563, SOT-666', 'other'],
    ['SC-70-6', 'other'],
  ])('reads %s as %s', (text, family) => {
    expect(parsePackage(text).family).toBe(family);
  });

  it.each([
    ['', 'nothing at all'],
    ['Cylinder, Threaded', 'no package name'],
    ['1210 (3225 Metric)', 'a chip size rather than a package'],
    ['2-SMD, J-Lead', 'a mounting style rather than a package'],
    ['8-MLF® (2x2)', 'a brand covering both QFN and DFN'],
    ['6-TSSOP, SC-88, SOT-363', 'two families that disagree'],
  ])('reads %s as no family: %s', (text) => {
    expect(parsePackage(text).family).toBeNull();
  });

  it('lets a stated body width settle a text naming two families', () => {
    expect(parsePackage('8-TSSOP, 8-MSOP (0.118", 3.00mm Width)').family).toBe('msop');
    expect(parsePackage('10-PowerTFSOP, 10-MSOP (0.118", 3.00mm Width)').family).toBe('msop');
    // Without the width the two names decide nothing.
    expect(parsePackage('8-TSSOP, 8-MSOP').family).toBeNull();
  });
});

describe('parsePackage pins', () => {
  it.each([
    ['8-SOIC (0.154", 3.90mm Width)', 8],
    ['SOT-23-6 Thin, TSOT-23-6', 6],
    ['SOT-23-5', 5],
    ['TSOT-26', 6],
    ['16-TFSOP (0.118", 3.00mm Width), 12 Leads, Exposed Pad', 12],
    ['12-VQFN-HR (3x2)', 12],
    ['SOIC-8', 8],
    ['TSSOP-14', 14],
    ['PowerSO-8', 8],
    ['2-SMD, J-Lead', 2],
  ])('reads %s as %i pins', (text, pins) => {
    expect(parsePackage(text).pins).toBe(pins);
  });

  it.each([
    ['SOT-583', 'a package name whose digits are not a lead count'],
    ['SOT-223', 'a package name whose digits would otherwise read as 223 leads'],
    ['SC-70-6', 'a name whose parts are both too short to be a family'],
    ['SOT-563, SOT-666', 'two such names'],
    ['V-DFN3020-13 (Type A)', 'a body size in the middle of the name'],
    ['1210 (3225 Metric)', 'a chip size'],
    ['Cylinder, Threaded', 'no number at all'],
    ['', 'nothing at all'],
  ])('reads %s as no pin count: %s', (text) => {
    expect(parsePackage(text).pins).toBeNull();
  });

  it('rejects a lead count outside what a package can have', () => {
    expect(parsePackage('999-QFN').pins).toBeNull();
    expect(parsePackage('1-SMD').pins).toBeNull();
  });

  it('normalises the text it read', () => {
    expect(parsePackage('  8-soic (0.154", 3.90mm Width) ').text).toBe(
      '8-SOIC (0.154", 3.90MM WIDTH)',
    );
  });
});
