import { describe, expect, it } from 'vitest';

import { decoderFor } from '../../src/mpn/decoders/index.js';
import { normaliseMpn } from '../../src/mpn/normalise.js';
import type { DecodedMpn } from '../../src/mpn/types.js';
import {
  corpusFiles,
  familyOfPackageName,
  isBoard,
  loadCorpus,
  pinsOfPackageName,
  temperatureOf,
  type CorpusEntry,
} from '../helpers/mpn-corpus.js';

/**
 * The decoders against the recorded corpus of real part numbers.
 *
 * Every part number here came from a live Digi-Key keyword search, together
 * with Digi-Key's own package, packaging and operating-temperature fields.
 * That makes this an independent check rather than a restatement of the
 * tables: a decoder that claims a package the distributor contradicts fails.
 *
 * Task 10.6 asks for at least thirty real part numbers per decoder group;
 * `scripts/record-mpn-corpus.ts` records them, and the first test below holds
 * that line as families are added.
 */

interface Group {
  readonly file: string;
  readonly entries: readonly CorpusEntry[];
}

function partsOf(file: string): Group {
  return {
    file,
    entries: loadCorpus(file).filter(
      (entry) => decoderFor(entry.manufacturer) !== null && !isBoard(entry.mpn),
    ),
  };
}

const GROUPS: readonly Group[] = corpusFiles().map(partsOf);

/**
 * Listings whose part number is not a part number.
 *
 * Digi-Key writes a parenthesised revision into these three, and parentheses
 * are not characters a part number holds, so normalisation rejects them
 * before a decoder ever sees them.
 */
const UNUSABLE: Readonly<Record<string, string>> = {
  'RT8237EZQW(2)': 'Digi-Key writes a parenthesised revision into the part number',
  'RT8237CZQW(2)': 'Digi-Key writes a parenthesised revision into the part number',
  'RT8237HGQW(2)': 'Digi-Key writes a parenthesised revision into the part number',
};

/** Part numbers no decoder reads, each with the reason it is left alone. */
const UNDECODED: Readonly<Record<string, string>> = {
  TPS54KC23RZRR: 'the device number KC23 does not fit any TI numbering the corpus shows',
  'AP62CO5ZCW20-13': 'the CO5ZCW20 suffix appears once and matches no known Diodes code',
  'MIC280-7BM6TS': 'the trailing TS after a complete Micrel suffix is unexplained',
  'MIC23051-16YML TR': 'Digi-Key lists this one with a space inside the part number',
  'MIC2807-NGYML TR': 'Digi-Key lists this one with a space inside the part number',
  CDLL5987: 'a Microchip zener the keyword search returned, not an MCP or MIC device',
  NCP6335EMT30TBG: 'MT30TB reads as neither an onsemi package nor a reel code',
  'AP62250WU-7-N': 'the trailing -N after a complete Diodes suffix is unexplained',
  'AP62300WU-7-N': 'the trailing -N after a complete Diodes suffix is unexplained',
  'AP62300TWU-7-N': 'the trailing -N after a complete Diodes suffix is unexplained',
  'AP62301WU-7-N': 'the trailing -N after a complete Diodes suffix is unexplained',
};

describe('the recorded corpus', () => {
  it('holds at least thirty real part numbers for every decoder group', () => {
    for (const group of GROUPS) {
      expect(group.entries.length, group.file).toBeGreaterThanOrEqual(30);
    }
    expect(GROUPS).toHaveLength(8);
  });

  it('is made of part numbers that survive normalisation, bar the recorded few', () => {
    const rejected: string[] = [];
    for (const group of GROUPS) {
      for (const entry of group.entries) {
        try {
          normaliseMpn(entry.mpn);
        } catch {
          rejected.push(entry.mpn);
        }
      }
    }
    expect(rejected.sort()).toEqual(Object.keys(UNUSABLE).sort());
  });
});

describe('decoding the corpus', () => {
  it('reads all but the handful of part numbers nobody can explain', () => {
    const misses: string[] = [];
    let parts = 0;
    for (const group of GROUPS) {
      for (const entry of group.entries) {
        parts += 1;
        if (!(entry.mpn in UNUSABLE) && decoderFor(entry.manufacturer)?.decode(entry.mpn) == null) {
          misses.push(entry.mpn);
        }
      }
    }
    expect(parts).toBeGreaterThan(500);
    for (const miss of misses) {
      expect(Object.keys(UNDECODED), `${miss} is undecoded but not recorded as such`).toContain(
        miss,
      );
    }
    expect(misses.length / parts).toBeLessThan(0.02);
  });

  it('never reads an evaluation board as a part', () => {
    for (const file of corpusFiles()) {
      for (const entry of loadCorpus(file)) {
        if (!isBoard(entry.mpn)) {
          continue;
        }
        expect(decoderFor(entry.manufacturer)?.decode(entry.mpn) ?? null, entry.mpn).toBeNull();
      }
    }
  });
});

interface Decoded {
  readonly entry: CorpusEntry;
  readonly decoded: DecodedMpn;
}

function decodedEntries(): readonly Decoded[] {
  const decoded: Decoded[] = [];
  for (const group of GROUPS) {
    for (const entry of group.entries) {
      const result = decoderFor(entry.manufacturer)?.decode(entry.mpn) ?? null;
      if (result !== null) {
        decoded.push({ entry, decoded: result });
      }
    }
  }
  return decoded;
}

const DECODED = decodedEntries();

describe('what the decoders claim, against what Digi-Key reports', () => {
  it('agrees about the package family wherever it claims one', () => {
    let checked = 0;
    for (const { entry, decoded } of DECODED) {
      const family = decoded.package?.family;
      const expected = familyOfPackageName(entry.supplierPackage);
      if (family == null || expected === null) {
        continue;
      }
      checked += 1;
      expect(family, `${entry.mpn} (${entry.supplierPackage})`).toBe(expected);
    }
    expect(checked).toBeGreaterThan(400);
  });

  it('agrees about the pin count wherever it claims one', () => {
    let checked = 0;
    for (const { entry, decoded } of DECODED) {
      const pins = decoded.package?.pins;
      const expected = pinsOfPackageName(entry.supplierPackage);
      if (pins == null || expected === null) {
        continue;
      }
      checked += 1;
      expect(pins, `${entry.mpn} (${entry.supplierPackage})`).toBe(expected);
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('agrees about the temperature range wherever it claims one', () => {
    let checked = 0;
    for (const { entry, decoded } of DECODED) {
      const range = decoded.temperatureGrade?.range;
      const expected = temperatureOf(entry.operatingTemperature);
      if (range == null || expected === null) {
        continue;
      }
      checked += 1;
      expect(
        { minC: range.minC, maxC: range.maxC },
        `${entry.mpn} grade ${decoded.temperatureGrade?.code ?? '?'}`,
      ).toEqual({ minC: expected.minC, maxC: expected.maxC });
    }
    expect(checked).toBeGreaterThan(80);
  });

  it('reports the packaging the part number states, which is not where a distributor stocks it', () => {
    // Two parts in the corpus say tape and reel and are stocked in bulk:
    // AP62400WU-7 and NCV891930MW01R2G. Both facts are true, of different
    // things — the manufacturer ships a reel, Digi-Key breaks it — so this
    // asserts the agreement is close to total rather than total.
    const reeled = DECODED.filter(({ decoded }) => decoded.packaging === 'reel');
    const disagreeing = reeled.filter(
      ({ entry }) => !entry.packagings.some((name) => /tape\s*&\s*reel|cut tape/i.test(name)),
    );
    expect(reeled.length).toBeGreaterThan(300);
    expect(disagreeing.map(({ entry }) => entry.mpn)).toEqual(['AP62400WU-7', 'NCV891930MW01R2G']);
  });

  it('gives every part number of a family the same family key', () => {
    const families = new Map<string, Set<string>>();
    for (const { decoded } of DECODED) {
      const bases = families.get(decoded.family) ?? new Set<string>();
      bases.add(decoded.basePart);
      families.set(decoded.family, bases);
    }
    // A family with one base part is a part with no options; several base
    // parts in one family is the normal case, and is what makes sibling
    // detection possible at all.
    expect(families.size).toBeGreaterThan(100);
    expect([...families.values()].some((bases) => bases.size > 1)).toBe(true);
  });
});
