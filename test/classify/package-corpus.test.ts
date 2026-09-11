import { describe, expect, it } from 'vitest';

import { parsePackage } from '../../src/classify/package-shape.js';
import { PACKAGE_FAMILIES, type PackageFamily } from '../../src/core/classification.js';
import { corpusFiles, loadCorpus, type CorpusEntry } from '../helpers/mpn-corpus.js';

/**
 * The package parser read against Digi-Key's two package fields for every
 * recorded part. `Package / Case` and `Supplier Device Package` describe the
 * same package in different vocabularies, so where both name a family they
 * are an independent check on each other, and on the table that reads them.
 */
const ENTRIES: readonly CorpusEntry[] = corpusFiles().flatMap((file) => loadCorpus(file));

/** `Package / Case` texts that name no family, each for a stated reason. */
const NO_FAMILY: Readonly<Record<string, string>> = {
  '2-SMD, J-Lead': 'a mounting style and a lead shape, naming no package family',
  '6-TSSOP, SC-88, SOT-363': 'names a TSSOP and a 6-lead SC-70, which disagree',
  'Cylinder, Threaded': 'not an integrated circuit package at all',
  '1210 (3225 Metric)': 'a chip size: the row is a passive part from a keyword search',
  '0805 (2012 Metric)': 'a chip size: the row is a passive part from a keyword search',
  '1008 (2520 Metric)': 'a chip size: the row is a passive part from a keyword search',
  '0806 (2016 Metric)': 'a chip size: the row is a passive part from a keyword search',
};

/**
 * Parts whose two Digi-Key fields name different families.
 *
 * Digi-Key's own data disagrees here, not the table: `Package / Case` says
 * DFN and `Supplier Device Package` says QFN for the same listing. The MPS
 * decoder reads `GQ` and `DQ` as QFN from the same corpus (D32), so two of
 * the three readings say QFN, and neither field is corrected here — a
 * distributor field is recorded as it was published.
 */
const FIELD_DISAGREEMENTS: Readonly<Record<string, string>> = {
  'MPQ4423GQ-AEC1-Z': '8-VDFN against 8-QFN (3x3)',
  'MPQ4423AGQ-AEC1-Z': '8-VDFN against 8-QFN (3x3)',
  'MPQ4423HGQ-Z': '8-VDFN against 8-QFN (3x3)',
  'MPQ4423HGQ-AEC1-Z': '8-VDFN against 8-QFN (3x3)',
  'MPQ4569GQ-P': '10-VFDFN Exposed Pad against 10-QFN (3x3)',
  'MPQ4558DQ-AEC1-LF-Z': '10-VFDFN Exposed Pad against 10-QFN (3x3)',
  L7986: '10-VFDFN Exposed Pad against 10-VFQFPN (3x3)',
  L5987: '8-VFDFN Exposed Pad against 8-VFQFPN (3x3)',
  L5987TR: '8-VFDFN Exposed Pad against 8-VFQFPN (3x3)',
};

/**
 * The one text whose two fields state different lead counts. Both are true:
 * the package is a 16-lead MSOP body with 12 leads fitted, which `Package /
 * Case` states outright and the supplier name does not.
 */
const LEADS_STATED = '16-TFSOP (0.118", 3.00mm Width), 12 Leads, Exposed Pad';

describe('package families across the recorded corpus', () => {
  it('has parts to check', () => {
    expect(ENTRIES.length).toBeGreaterThan(700);
  });

  it('names a family for every Package / Case except those listed here', () => {
    const unread = new Set<string>();
    for (const entry of ENTRIES) {
      if (entry.packageCase !== '' && parsePackage(entry.packageCase).family === null) {
        unread.add(entry.packageCase);
      }
    }
    expect([...unread].sort()).toEqual(Object.keys(NO_FAMILY).sort());
  });

  it('agrees with Digi-Key’s supplier package wherever both name a family', () => {
    const disagreed = new Map<string, string>();
    let compared = 0;
    for (const entry of ENTRIES) {
      const listed = parsePackage(entry.packageCase).family;
      const supplier = parsePackage(entry.supplierPackage).family;
      if (listed === null || supplier === null) {
        continue;
      }
      compared += 1;
      if (listed !== supplier) {
        disagreed.set(entry.mpn, `${entry.packageCase} against ${entry.supplierPackage}`);
      }
    }
    expect(compared).toBeGreaterThan(500);
    expect(Object.fromEntries([...disagreed].sort())).toEqual(
      Object.fromEntries(Object.entries(FIELD_DISAGREEMENTS).sort()),
    );
  });

  it('agrees with the supplier package on lead count, bar the one that states both', () => {
    const disagreed = new Set<string>();
    let compared = 0;
    for (const entry of ENTRIES) {
      const listed = parsePackage(entry.packageCase).pins;
      const supplier = parsePackage(entry.supplierPackage).pins;
      if (listed === null || supplier === null) {
        continue;
      }
      compared += 1;
      if (listed !== supplier) {
        disagreed.add(entry.packageCase);
      }
    }
    expect(compared).toBeGreaterThan(500);
    expect([...disagreed]).toEqual([LEADS_STATED]);
    // The stated lead count wins over the body's position count.
    expect(parsePackage(LEADS_STATED).pins).toBe(12);
    expect(parsePackage('16-MSOP-EP').pins).toBe(16);
  });

  it('exercises every family in the vocabulary but the through-hole ones', () => {
    const seen = new Set<PackageFamily>();
    for (const entry of ENTRIES) {
      for (const text of [entry.packageCase, entry.supplierPackage]) {
        const { family } = parsePackage(text);
        if (family !== null) {
          seen.add(family);
        }
      }
    }
    // Every recorded part is a surface-mount switching regulator, so the
    // through-hole families and SOT-223 rest on hand-written cases alone.
    expect([...seen].sort()).toEqual(
      PACKAGE_FAMILIES.filter(
        (family) => family !== 'to220' && family !== 'to263' && family !== 'sot223',
      ).sort(),
    );
  });
});
