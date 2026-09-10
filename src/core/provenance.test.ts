import { describe, it } from 'vitest';

import {
  datasheetProvenance,
  derivedProvenance,
  distributorProvenance,
  humanProvenance,
} from '../../test/helpers/core-fixtures.js';
import { expectAccepts, expectRejects } from '../../test/helpers/schema.js';
import {
  DatasheetProvenance,
  DerivedProvenance,
  DistributorProvenance,
  HumanProvenance,
  Provenance,
} from './provenance.js';

describe('DatasheetProvenance', () => {
  it('accepts a page-cited value with or without a quote', () => {
    expectAccepts(DatasheetProvenance, datasheetProvenance());
    expectAccepts(
      DatasheetProvenance,
      datasheetProvenance(12, { method: 'image', quote: 'VIN 3.5 V to 28 V' }),
    );
  });

  it('rejects a missing page number: no page, no store', () => {
    const { page: _page, ...withoutPage } = datasheetProvenance();
    expectRejects(DatasheetProvenance, withoutPage, 'page');
  });

  it.each([
    ['page 0', datasheetProvenance(0)],
    ['a fractional page', datasheetProvenance(1.5)],
    ['a page given as text', datasheetProvenance(5, { page: '5' })],
    ['a bad digest', datasheetProvenance(5, { sha256: 'abc' })],
    ['an unknown method', datasheetProvenance(5, { method: 'ocr' })],
    ['an empty quote', datasheetProvenance(5, { quote: ' ' })],
    ['an over-long quote', datasheetProvenance(5, { quote: 'x'.repeat(501) })],
    ['an extra key', datasheetProvenance(5, { url: 'https://x' })],
  ])('rejects %s', (_label, value) => {
    expectRejects(DatasheetProvenance, value);
  });
});

describe('DistributorProvenance', () => {
  it('accepts a distributor citation', () => {
    expectAccepts(DistributorProvenance, distributorProvenance());
    expectAccepts(
      DistributorProvenance,
      distributorProvenance({ distributor: 'mouser', sku: '595-TPS54331DR' }),
    );
  });

  it.each([
    ['an unknown distributor', distributorProvenance({ distributor: 'arrow' })],
    ['an empty sku', distributorProvenance({ sku: '' })],
    ['a local timestamp', distributorProvenance({ fetchedAt: '2026-09-10T10:00:00+10:00' })],
    ['a bad cache key', distributorProvenance({ cacheKey: 'nope' })],
    [
      'a missing cache key',
      (() => {
        const { cacheKey: _key, ...rest } = distributorProvenance();
        return rest;
      })(),
    ],
  ])('rejects %s', (_label, value) => {
    expectRejects(DistributorProvenance, value);
  });
});

describe('HumanProvenance', () => {
  it('accepts a note with a timestamp', () => {
    expectAccepts(HumanProvenance, humanProvenance());
  });

  it.each([
    ['an empty note', humanProvenance({ note: '' })],
    ['an over-long note', humanProvenance({ note: 'x'.repeat(1001) })],
    [
      'a missing timestamp',
      (() => {
        const { recordedAt: _at, ...rest } = humanProvenance();
        return rest;
      })(),
    ],
  ])('rejects %s', (_label, value) => {
    expectRejects(HumanProvenance, value);
  });
});

describe('DerivedProvenance', () => {
  it('accepts a rule with at least one source parameter', () => {
    expectAccepts(DerivedProvenance, derivedProvenance());
    expectAccepts(DerivedProvenance, derivedProvenance({ from: ['ioutMax'] }));
  });

  it.each([
    ['no source parameters', derivedProvenance({ from: [] })],
    ['an unknown parameter key', derivedProvenance({ from: ['vinMinimum'] })],
    ['an empty rule', derivedProvenance({ rule: ' ' })],
  ])('rejects %s', (_label, value) => {
    expectRejects(DerivedProvenance, value);
  });
});

describe('Provenance', () => {
  it('accepts every variant', () => {
    expectAccepts(Provenance, datasheetProvenance());
    expectAccepts(Provenance, distributorProvenance());
    expectAccepts(Provenance, humanProvenance());
    expectAccepts(Provenance, derivedProvenance());
  });

  it.each([
    ['an unknown source', { source: 'guess', page: 1 }],
    ['a missing source', { sha256: 'a'.repeat(64), page: 1, method: 'text' }],
    ['fields from another variant', datasheetProvenance(5, { note: 'x' })],
    ['a string', 'datasheet p.5'],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    expectRejects(Provenance, value);
  });
});
