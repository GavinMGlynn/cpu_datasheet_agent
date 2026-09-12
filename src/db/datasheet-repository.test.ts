import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ValidationError } from '../core/validation-error.js';
import { OTHER_SHA, SHA, datasheet } from '../../test/helpers/core-fixtures.js';
import type { Db } from './database.js';
import { DbError } from './database.js';
import { DatasheetRepository } from './datasheet-repository.js';
import { openDatabase } from './open.js';

let db: Db;
let repo: DatasheetRepository;

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = new DatasheetRepository(db);
});

afterEach(() => {
  db.close();
});

describe('DatasheetRepository', () => {
  it('records and returns a datasheet unchanged', () => {
    const input = datasheet();
    expect(repo.record(input)).toEqual(input);
    expect(repo.getBySha(SHA)).toEqual(input);
    expect(repo.mpnsCoveredBy(SHA)).toEqual(['TPS54331D', 'TPS54331DR']);
  });

  it('updates an existing digest and replaces its MPN list', () => {
    repo.record(datasheet());
    const updated = datasheet({ pageCount: 41, coversMpns: ['TPS54331DR', 'TPS54331DDAR'] });
    expect(repo.record(updated)).toEqual(updated);
    expect(repo.mpnsCoveredBy(SHA)).toEqual(['TPS54331DR', 'TPS54331DDAR']);
  });

  it('rejects an invalid datasheet before writing', () => {
    expect(() => repo.record(datasheet({ pageCount: 0 }))).toThrow(ValidationError);
    expect(repo.getBySha(SHA)).toBeUndefined();
  });

  it('returns undefined for an unknown digest', () => {
    expect(repo.getBySha(OTHER_SHA)).toBeUndefined();
  });

  it('links additional MPNs idempotently', () => {
    repo.record(datasheet({ coversMpns: [] }));
    repo.linkMpn(SHA, 'TPS54331DR');
    repo.linkMpn(SHA, 'TPS54331DR');
    repo.linkMpn(SHA, 'TPS54331D');
    expect(repo.mpnsCoveredBy(SHA)).toEqual(['TPS54331DR', 'TPS54331D']);
  });

  it('refuses to link to an unknown datasheet or with invalid values', () => {
    expect(() => {
      repo.linkMpn(OTHER_SHA, 'X');
    }).toThrow(DbError);
    try {
      repo.linkMpn(OTHER_SHA, 'X');
    } catch (error) {
      expect((error as DbError).code).toBe('DB_DATASHEET_NOT_FOUND');
    }
    repo.record(datasheet());
    expect(() => {
      repo.linkMpn('nope', 'X');
    }).toThrow(ValidationError);
    expect(() => {
      repo.linkMpn(SHA, 'lower case');
    }).toThrow(ValidationError);
  });

  it('lists every datasheet, most recently fetched first', () => {
    repo.record(datasheet());
    repo.record(
      datasheet({
        sha256: OTHER_SHA,
        url: 'https://example.invalid/other.pdf',
        fetchedAt: '2026-09-11T00:00:00Z',
        coversMpns: ['LM5164DDAR'],
      }),
    );
    expect(repo.list().map((sheet) => sheet.sha256)).toEqual([OTHER_SHA, SHA]);
    expect(repo.list()[0]?.coversMpns).toEqual(['LM5164DDAR']);
  });

  it('has no datasheets to list in an empty store', () => {
    expect(repo.list()).toEqual([]);
  });

  it('finds every datasheet covering an MPN, ordered by digest', () => {
    repo.record(datasheet({ sha256: OTHER_SHA, coversMpns: ['TPS54331DR'] }));
    repo.record(datasheet());
    expect(repo.findByMpn('TPS54331DR').map((found) => found.sha256)).toEqual([SHA, OTHER_SHA]);
    expect(repo.findByMpn('TPS54331D').map((found) => found.sha256)).toEqual([SHA]);
    expect(repo.findByMpn('NONE')).toEqual([]);
  });
});
