import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ValidationError } from '../core/validation-error.js';
import {
  buckParameters,
  classification,
  distributorProvenance,
  humanProvenance,
  offer,
  param,
  part,
  q,
  verification,
  withConfidence,
  type Loose,
} from '../../test/helpers/core-fixtures.js';
import type { Db } from './database.js';
import { openDatabase } from './open.js';
import { PartRepository } from './part-repository.js';

let db: Db;
let repo: PartRepository;

function count(table: string): number {
  return db.raw.prepare<[], { n: number }>(`SELECT count(*) AS n FROM ${table}`).get()?.n ?? -1;
}

/** A 12 V, 1.5 A synchronous part with a different MPN. */
function smallPart(overrides: Loose = {}): Loose {
  return part({
    mpn: 'MP1584EN',
    manufacturer: 'Monolithic Power Systems',
    parameters: withConfidence(
      buckParameters({
        vinMin: param(q(4.5, 'V')),
        vinMax: param(q(12, 'V')),
        vinAbsMax: param(q(14, 'V')),
        ioutMax: param(q(1.5, 'A')),
        topology: param('synchronous'),
        rdsOnLow: param(q(0.05, 'Ohm')),
        switchingFrequency: param({ unit: 'Hz', min: 100000, max: 1500000 }),
      }),
      'verified',
    ),
    offers: [offer({ sku: 'MP-1', provenance: distributorProvenance({ sku: 'MP-1' }) })],
    classifications: [
      classification({ value: 'le_18v' }),
      classification({ axis: 'features', value: ['enable', 'sync'], derivedFrom: ['enablePin'] }),
    ],
    status: 'verified',
    ...overrides,
  });
}

function humanSourced(parameters: Loose): Loose {
  const out: Loose = {};
  for (const [key, value] of Object.entries(parameters)) {
    out[key] = { ...(value as Loose), provenance: humanProvenance() };
  }
  return out;
}

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = new PartRepository(db);
});

afterEach(() => {
  db.close();
});

describe('PartRepository.upsertPart', () => {
  it('stores the aggregate and reads it back unchanged', () => {
    const input = part({ verifications: [verification()] });
    expect(repo.upsertPart(input)).toEqual(input);
    expect(repo.getPart('TPS54331DR')).toEqual(input);
    expect(repo.getPartId('TPS54331DR')).toBe(1);
    expect(count('parameters')).toBe(30);
    expect(count('offers')).toBe(1);
    expect(count('price_breaks')).toBe(3);
    expect(count('classifications')).toBe(1);
    expect(count('verifications')).toBe(1);
    expect(count('datasheets')).toBe(1);
  });

  it('replaces every child row on update', () => {
    repo.upsertPart(part({ verifications: [verification()] }));
    const updated = part({
      parameters: buckParameters({ ioutMax: param(q(3.5, 'A')) }),
      offers: [],
      classifications: [],
      verifications: [],
      status: 'needs_human',
      updatedAt: '2026-09-11T00:00:00Z',
    });
    expect(repo.upsertPart(updated)).toEqual(updated);
    expect(repo.getPart('TPS54331DR')).toEqual(updated);
    expect(count('parts')).toBe(1);
    expect(count('offers')).toBe(0);
    expect(count('price_breaks')).toBe(0);
    expect(count('classifications')).toBe(0);
    expect(count('verifications')).toBe(0);
  });

  it('stores a part without a datasheet', () => {
    const { datasheet: _datasheet, ...input } = part({
      parameters: humanSourced(buckParameters()),
    });
    expect(repo.upsertPart(input)).toEqual(input);
    expect(repo.getPart('TPS54331DR')).toEqual(input);
    expect(repo.getPart('TPS54331DR')).not.toHaveProperty('datasheet');
  });

  it('lets two parts share one datasheet', () => {
    repo.upsertPart(part());
    repo.upsertPart(smallPart());
    expect(count('datasheets')).toBe(1);
    expect(repo.getPart('MP1584EN')?.datasheet?.sha256).toBe(
      repo.getPart('TPS54331DR')?.datasheet?.sha256,
    );
  });

  it('rejects the CLAUDE.md case and writes nothing', () => {
    expect(() =>
      repo.upsertPart(part({ parameters: buckParameters({ vinMin: param('3 V to 32 V') }) })),
    ).toThrow(ValidationError);
    expect(() => repo.upsertPart({ mpn: 'X' })).toThrow(ValidationError);
    expect(() => repo.upsertPart('TPS54331DR')).toThrow(ValidationError);
    expect(count('parts')).toBe(0);
    expect(count('datasheets')).toBe(0);
  });

  it('rolls back everything when a later insert fails', () => {
    db.raw.exec('DROP TABLE verifications');
    expect(() => repo.upsertPart(part())).toThrow(/no such table: verifications/);
    expect(count('parts')).toBe(0);
    expect(count('parameters')).toBe(0);
    expect(count('datasheets')).toBe(0);
  });

  it('returns undefined for an unknown part', () => {
    expect(repo.getPart('NOPE')).toBeUndefined();
    expect(repo.getPartId('NOPE')).toBeUndefined();
  });

  it('cascades child rows when a part row is deleted', () => {
    repo.upsertPart(part({ verifications: [verification()] }));
    db.raw.prepare('DELETE FROM parts WHERE mpn = ?').run('TPS54331DR');
    expect(count('parameters')).toBe(0);
    expect(count('offers')).toBe(0);
    expect(count('price_breaks')).toBe(0);
    expect(count('classifications')).toBe(0);
    expect(count('verifications')).toBe(0);
  });

  it('enforces the datasheet foreign key at the database level', () => {
    expect(() =>
      db.raw
        .prepare(
          'INSERT INTO parts (mpn, manufacturer, category, datasheet_sha256, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'X',
          'm',
          'buck_regulator',
          'f'.repeat(64),
          'extracted',
          '2026-09-10T00:00:00Z',
          '2026-09-10T00:00:00Z',
        ),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});

describe('PartRepository.findParts', () => {
  beforeEach(() => {
    repo.upsertPart(part());
    repo.upsertPart(smallPart());
  });

  it('returns every part ordered by MPN with no filter', () => {
    expect(repo.findParts().map((found) => found.mpn)).toEqual(['MP1584EN', 'TPS54331DR']);
  });

  it('filters by category and status', () => {
    expect(repo.findParts({ category: 'buck_regulator' })).toHaveLength(2);
    expect(repo.findParts({ status: 'verified' }).map((found) => found.mpn)).toEqual(['MP1584EN']);
    expect(repo.listByStatus('extracted').map((found) => found.mpn)).toEqual(['TPS54331DR']);
    expect(repo.listByStatus('rejected')).toEqual([]);
  });

  it('filters by classification values, including single features', () => {
    expect(
      repo
        .findParts({ classifications: [{ axis: 'vinClass', value: 'le_42v' }] })
        .map((found) => found.mpn),
    ).toEqual(['TPS54331DR']);
    expect(
      repo
        .findParts({ classifications: [{ axis: 'vinClass', value: 'le_18v' }] })
        .map((found) => found.mpn),
    ).toEqual(['MP1584EN']);
    expect(
      repo
        .findParts({ classifications: [{ axis: 'features', value: 'sync' }] })
        .map((found) => found.mpn),
    ).toEqual(['MP1584EN']);
    expect(
      repo.findParts({ classifications: [{ axis: 'features', value: 'power_good' }] }),
    ).toEqual([]);
    expect(
      repo
        .findParts({
          classifications: [
            { axis: 'vinClass', value: 'le_18v' },
            { axis: 'features', value: 'enable' },
          ],
        })
        .map((found) => found.mpn),
    ).toEqual(['MP1584EN']);
  });

  it('filters by numeric parameter bounds', () => {
    expect(
      repo.findParts({ parameters: [{ key: 'vinMax', min: 20 }] }).map((found) => found.mpn),
    ).toEqual(['TPS54331DR']);
    expect(
      repo.findParts({ parameters: [{ key: 'vinMax', max: 20 }] }).map((found) => found.mpn),
    ).toEqual(['MP1584EN']);
    expect(
      repo
        .findParts({ parameters: [{ key: 'ioutMax', min: 1, max: 2 }] })
        .map((found) => found.mpn),
    ).toEqual(['MP1584EN']);
    expect(
      repo
        .findParts({
          parameters: [
            { key: 'ioutMax', min: 1 },
            { key: 'vinMin', max: 4 },
          ],
        })
        .map((found) => found.mpn),
    ).toEqual(['TPS54331DR']);
    expect(repo.findParts({ parameters: [{ key: 'ioutMax', min: 10 }] })).toEqual([]);
  });

  it('treats a range parameter by its whole extent', () => {
    expect(
      repo
        .findParts({ parameters: [{ key: 'switchingFrequency', min: 100000, max: 1500000 }] })
        .map((found) => found.mpn),
    ).toEqual(['MP1584EN', 'TPS54331DR']);
    expect(
      repo
        .findParts({ parameters: [{ key: 'switchingFrequency', min: 200000 }] })
        .map((found) => found.mpn),
    ).toEqual(['TPS54331DR']);
    expect(
      repo
        .findParts({ parameters: [{ key: 'switchingFrequency', max: 1000000 }] })
        .map((found) => found.mpn),
    ).toEqual(['TPS54331DR']);
  });

  it('never matches non-numeric parameters on bounds', () => {
    expect(repo.findParts({ parameters: [{ key: 'topology', min: 0 }] })).toEqual([]);
  });

  it('combines clauses and honours the limit', () => {
    expect(
      repo.findParts({ status: 'verified', parameters: [{ key: 'vinMax', min: 20 }] }),
    ).toEqual([]);
    expect(repo.findParts({ limit: 1 }).map((found) => found.mpn)).toEqual(['MP1584EN']);
    expect(repo.findParts({ limit: 1.9 })).toHaveLength(1);
    expect(repo.findParts({ limit: -3 })).toHaveLength(0);
  });
});

describe('PartRepository verifications without a quote', () => {
  it('round-trips a not_found verdict', () => {
    const db2 = openDatabase(':memory:');
    const repo2 = new PartRepository(db2);
    const { quote: _quote, ...notFound } = verification({ verdict: 'not_found' });
    const input = part({ verifications: [notFound, verification()] });
    expect(repo2.upsertPart(input)).toEqual(input);
    expect(repo2.getPart('TPS54331DR')?.verifications).toEqual([notFound, verification()]);
    db2.close();
  });
});
