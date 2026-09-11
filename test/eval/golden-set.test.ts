import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { tryClassify } from '../../src/classify/index.js';
import { CLASSIFICATION_AXES, PARAMETER_KEYS } from '../../src/core/index.js';
import { decoderFor } from '../../src/mpn/index.js';
import { loadGoldenSet, type LoadedGolden } from '../../src/eval/load.js';

const GOLDEN: readonly LoadedGolden[] = loadGoldenSet();

/**
 * Where the cached PDFs live when this machine has fetched them. The golden
 * files record the path inside the data directory, so the digest check runs
 * wherever the cache is warm and passes vacuously where it is empty: the PDFs
 * are the manufacturers' copyright and are never committed (D08).
 */
const DATA_DIR = process.env.DATA_DIR ?? 'data';

describe('the golden set', () => {
  it('holds the twenty parts the plan asks for, and every file validates', () => {
    expect(GOLDEN.length).toBeGreaterThanOrEqual(20);
  });

  it('names every parameter on every part', () => {
    for (const { file, part } of GOLDEN) {
      expect(Object.keys(part.parameters).sort(), file).toEqual([...PARAMETER_KEYS].sort());
    }
  });

  it('cites a page within the datasheet for every value, including the null ones', () => {
    for (const { file, part } of GOLDEN) {
      for (const key of PARAMETER_KEYS) {
        const { provenance } = part.parameters[key];
        expect(provenance.source, `${file} ${key}`).toBe('datasheet');
        if (provenance.source === 'datasheet') {
          expect(provenance.sha256, `${file} ${key}`).toBe(part.datasheet.sha256);
          expect(provenance.page, `${file} ${key}`).toBeGreaterThan(0);
          expect(provenance.page, `${file} ${key}`).toBeLessThanOrEqual(part.datasheet.pageCount);
        }
      }
    }
  });

  it('explains every value it could not read', () => {
    for (const { file, part } of GOLDEN) {
      for (const key of PARAMETER_KEYS) {
        if (part.parameters[key].value === null && key !== 'voutFixed' && key !== 'rdsOnLow') {
          expect(part.notes[key], `${file} ${key} is null and unexplained`).toBeDefined();
        }
      }
    }
  });

  it('agrees with the classifier on every axis it decided', () => {
    for (const { file, part } of GOLDEN) {
      const derived = tryClassify(part.parameters);
      for (const classification of derived.classifications) {
        const expected = part.classifications.find((one) => one.axis === classification.axis);
        expect(expected, `${file} has no expected ${classification.axis}`).toBeDefined();
        expect(classification.value, `${file} ${classification.axis}`).toEqual(expected?.value);
      }
      const undecided = derived.undecided.map((axis) => axis.axis);
      expect(part.classifications.map((one) => one.axis).sort(), file).toEqual(
        CLASSIFICATION_AXES.filter((axis) => !undecided.includes(axis)).sort(),
      );
    }
  });

  it('records what the part number says, and the decoder agrees or claims nothing', () => {
    for (const { file, part } of GOLDEN) {
      const decoded = decoderFor(part.manufacturer)?.decode(part.mpn);
      if (decoded === undefined || decoded === null) {
        continue;
      }
      expect(decoded.family, `${file} family`).toBe(part.decoded.family);
      expect(decoded.basePart, `${file} basePart`).toBe(part.decoded.basePart);
      expect(decoded.automotive, `${file} automotive`).toBe(part.decoded.automotive);
      expect(decoded.packaging, `${file} packaging`).toBe(part.decoded.packaging);
      if (decoded.package?.family != null) {
        expect(decoded.package.family, `${file} package family`).toBe(part.decoded.packageFamily);
      }
      if (decoded.package?.pins != null) {
        expect(decoded.package.pins, `${file} package pins`).toBe(part.decoded.pins);
      }
    }
  });

  it('covers every axis the plan asks it to', () => {
    const values = (axis: string): Set<unknown> =>
      new Set(
        GOLDEN.map(({ part }) => part.classifications.find((one) => one.axis === axis)?.value),
      );

    expect(values('vinClass')).toEqual(new Set(['le_5v5', 'le_18v', 'le_42v', 'le_60v', 'gt_60v']));
    expect([...values('ioutClass')]).toEqual(
      expect.arrayContaining(['le_1a', 'le_3a', 'le_6a', 'le_12a']),
    );
    expect(values('topology')).toEqual(new Set(['synchronous', 'non_synchronous']));
    expect(values('integration')).toEqual(new Set(['integrated_fet', 'controller']));
    expect(values('outputType')).toEqual(new Set(['fixed', 'adjustable']));
    expect(
      GOLDEN.filter(({ part }) => part.parameters.aecQ100.value).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('holds several parts that share one datasheet', () => {
    const byDigest = new Map<string, string[]>();
    for (const { part } of GOLDEN) {
      byDigest.set(part.datasheet.sha256, [
        ...(byDigest.get(part.datasheet.sha256) ?? []),
        part.mpn,
      ]);
    }
    expect([...byDigest.values()].filter((mpns) => mpns.length > 1).length).toBeGreaterThanOrEqual(
      3,
    );
  });

  it('matches the cached PDF wherever this machine has one', () => {
    let checked = 0;
    for (const { file, part } of GOLDEN) {
      const local = path.join(DATA_DIR, part.datasheet.localPath);
      if (!existsSync(local)) {
        continue;
      }
      checked += 1;
      const digest = createHash('sha256').update(readFileSync(local)).digest('hex');
      expect(digest, `${file} digest`).toBe(part.datasheet.sha256);
    }
    expect(checked).toBeGreaterThanOrEqual(0);
  });
});
