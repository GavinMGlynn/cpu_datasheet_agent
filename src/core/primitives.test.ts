import { describe, expect, it } from 'vitest';

import { expectAccepts, expectRejects } from '../../test/helpers/schema.js';
import {
  CURRENCIES,
  Celsius,
  Currency,
  DISTRIBUTORS,
  Distributor,
  Iso8601,
  ManufacturerName,
  NormalisedMpn,
  PageNumber,
  Percent,
  RawMpn,
  Sha256,
  Url,
} from './primitives.js';

describe('RawMpn', () => {
  it('accepts any non-empty text up to 64 characters and trims it', () => {
    expectAccepts(RawMpn, 'TPS54331DR');
    expect(RawMpn.parse('  tps 54331dr ')).toBe('tps 54331dr');
    expectAccepts(RawMpn, 'x'.repeat(64));
  });

  it.each(['', '   ', 'x'.repeat(65), 5, null])('rejects %j', (value) => {
    expectRejects(RawMpn, value);
  });
});

describe('NormalisedMpn', () => {
  it.each([
    'TPS54331DR',
    'LT8610EMSE#PBF',
    'LM2596S-5.0/NOPB',
    'MP1584EN-LF-Z',
    'AP63203WU-7',
    '7',
    'A'.repeat(64),
  ])('accepts %s', (value) => {
    expectAccepts(NormalisedMpn, value);
  });

  it.each([
    'tps54331dr',
    ' TPS54331DR',
    'TPS 54331',
    '-ABC',
    '#ABC',
    '',
    'A'.repeat(65),
    'TPS_54331',
    12,
  ])('rejects %j', (value) => {
    expectRejects(NormalisedMpn, value);
  });
});

describe('ManufacturerName', () => {
  it('accepts and trims names up to 128 characters', () => {
    expect(ManufacturerName.parse(' Texas Instruments ')).toBe('Texas Instruments');
    expectAccepts(ManufacturerName, 'x'.repeat(128));
  });

  it.each(['', ' ', 'x'.repeat(129), 0])('rejects %j', (value) => {
    expectRejects(ManufacturerName, value);
  });
});

describe('Sha256', () => {
  it('accepts 64 lowercase hex characters', () => {
    expectAccepts(Sha256, 'a'.repeat(64));
    expectAccepts(Sha256, '0123456789abcdef'.repeat(4));
  });

  it.each(['A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), '', 1])(
    'rejects %j',
    (value) => {
      expectRejects(Sha256, value);
    },
  );
});

describe('Iso8601', () => {
  it.each(['2026-09-10T00:00:00Z', '2026-09-10T23:59:59.123Z', '2000-01-01T00:00:00.000000Z'])(
    'accepts UTC timestamp %s',
    (value) => {
      expectAccepts(Iso8601, value);
    },
  );

  it.each([
    '2026-09-10T00:00:00+10:00',
    '2026-09-10T00:00:00',
    '2026-09-10',
    '2026-13-01T00:00:00Z',
    'yesterday',
    '',
    1757462400000,
  ])('rejects %j', (value) => {
    expectRejects(Iso8601, value);
  });
});

describe('Url', () => {
  it.each(['https://www.ti.com/lit/ds/symlink/tps54331.pdf', 'http://example.com/a?b=c#d'])(
    'accepts %s',
    (value) => {
      expectAccepts(Url, value);
    },
  );

  it.each([
    'ftp://example.com/x.pdf',
    'file:///tmp/x.pdf',
    '/relative/path.pdf',
    'www.ti.com/x.pdf',
    '',
    3,
  ])('rejects %j', (value) => {
    expectRejects(Url, value);
  });
});

describe('PageNumber', () => {
  it.each([1, 2, 400])('accepts %d', (value) => {
    expectAccepts(PageNumber, value);
  });

  it.each([0, -1, 1.5, '1', null, Number.NaN, Number.POSITIVE_INFINITY])('rejects %j', (value) => {
    expectRejects(PageNumber, value);
  });
});

describe('Currency', () => {
  it.each(CURRENCIES)('accepts %s', (value) => {
    expectAccepts(Currency, value);
  });

  it.each(['aud', 'AU', 'XXX', '', 1])('rejects %j', (value) => {
    expectRejects(Currency, value);
  });
});

describe('Percent', () => {
  it.each([0, 50.5, 100])('accepts %d', (value) => {
    expectAccepts(Percent, value);
  });

  it.each([-0.1, 100.1, '50', Number.NaN])('rejects %j', (value) => {
    expectRejects(Percent, value);
  });
});

describe('Celsius', () => {
  it.each([-273.15, -40, 0, 125, 1000])('accepts %d', (value) => {
    expectAccepts(Celsius, value);
  });

  it.each([-273.16, 1000.5, '25', Number.NaN])('rejects %j', (value) => {
    expectRejects(Celsius, value);
  });
});

describe('Distributor', () => {
  it.each(DISTRIBUTORS)('accepts %s', (value) => {
    expectAccepts(Distributor, value);
  });

  it.each(['DigiKey', 'octopart', '', 0])('rejects %j', (value) => {
    expectRejects(Distributor, value);
  });
});
