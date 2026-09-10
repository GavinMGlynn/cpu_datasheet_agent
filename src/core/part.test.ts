import { describe, it } from 'vitest';

import {
  EARLIER,
  LATER,
  OTHER_SHA,
  buckParameters,
  classification,
  humanProvenance,
  offer,
  param,
  part,
  q,
  verification,
  withConfidence,
  type Loose,
} from '../../test/helpers/core-fixtures.js';
import { expectAccepts, expectRejects } from '../../test/helpers/schema.js';
import { CATEGORIES, Category, PART_STATUSES, Part, PartStatus } from './part.js';

/** Every parameter re-pointed at human provenance so the part needs no datasheet. */
function humanSourced(parameters: Loose): Loose {
  const out: Loose = {};
  for (const [key, value] of Object.entries(parameters)) {
    out[key] = { ...(value as Loose), provenance: humanProvenance() };
  }
  return out;
}

describe('enums', () => {
  it.each(CATEGORIES)('Category accepts %s', (value) => {
    expectAccepts(Category, value);
  });
  it.each(PART_STATUSES)('PartStatus accepts %s', (value) => {
    expectAccepts(PartStatus, value);
  });
  it('rejects unknown values', () => {
    expectRejects(Category, 'boost_regulator');
    expectRejects(PartStatus, 'draft');
  });
});

describe('Part', () => {
  it('accepts the fixture part', () => {
    expectAccepts(Part, part());
  });

  it('accepts a part with no datasheet when nothing cites one', () => {
    const { datasheet: _datasheet, ...rest } = part({ parameters: humanSourced(buckParameters()) });
    expectAccepts(Part, rest);
  });

  it('accepts a verified part when every parameter is verified', () => {
    expectAccepts(
      Part,
      part({
        parameters: withConfidence(buckParameters(), 'verified'),
        verifications: [verification()],
        status: 'verified',
        updatedAt: LATER,
      }),
    );
  });

  it('accepts a conflicted parameter when the status is needs_human or rejected', () => {
    const parameters = buckParameters({ vinMax: param(q(28, 'V'), 4, 'conflict') });
    expectAccepts(Part, part({ parameters, status: 'needs_human' }));
    expectAccepts(Part, part({ parameters, status: 'rejected' }));
  });

  it('accepts several offers and classifications when keys differ', () => {
    expectAccepts(
      Part,
      part({
        offers: [
          offer(),
          offer({
            sku: '296-28446-2-ND',
            provenance: { ...(offer().provenance as Loose), sku: '296-28446-2-ND' },
          }),
        ],
        classifications: [
          classification(),
          classification({ axis: 'ioutClass', value: 'le_3a', derivedFrom: ['ioutMax'] }),
        ],
      }),
    );
  });

  describe('datasheet provenance', () => {
    it('rejects a parameter citing a datasheet when the part has none', () => {
      const { datasheet: _datasheet, ...rest } = part();
      expectRejects(Part, rest, 'parameters.vinMin.provenance');
    });

    it('rejects a parameter citing a different datasheet', () => {
      expectRejects(
        Part,
        part({
          parameters: buckParameters({
            ioutMax: {
              ...param(q(3, 'A')),
              provenance: { ...(param(q(3, 'A')).provenance as Loose), sha256: OTHER_SHA },
            },
          }),
        }),
        'parameters.ioutMax.provenance.sha256',
      );
    });

    it('rejects a page beyond the datasheet page count', () => {
      expectRejects(
        Part,
        part({ parameters: buckParameters({ ioutMax: param(q(3, 'A'), 41) }) }),
        'parameters.ioutMax.provenance.page',
      );
      expectAccepts(Part, part({ parameters: buckParameters({ ioutMax: param(q(3, 'A'), 40) }) }));
    });
  });

  describe('status invariants', () => {
    it('rejects verified status while any parameter is only extracted', () => {
      const parameters = withConfidence(buckParameters(), 'verified');
      parameters.aecQ100 = param(false, 1, 'extracted');
      expectRejects(Part, part({ parameters, status: 'verified' }), 'status');
    });

    it('rejects extracted or verified status while a parameter is in conflict', () => {
      const parameters = buckParameters({ vinMax: param(q(28, 'V'), 4, 'conflict') });
      expectRejects(Part, part({ parameters, status: 'extracted' }), 'status');
    });
  });

  describe('uniqueness', () => {
    it('rejects two classifications on the same axis', () => {
      expectRejects(
        Part,
        part({ classifications: [classification(), classification({ value: 'le_18v' })] }),
        'classifications.1.axis',
      );
    });

    it('rejects two offers with the same distributor and sku', () => {
      expectRejects(Part, part({ offers: [offer(), offer({ stock: 5 })] }), 'offers.1.sku');
    });
  });

  it('rejects updatedAt before createdAt', () => {
    expectRejects(Part, part({ updatedAt: EARLIER }), 'updatedAt');
  });

  it.each([
    ['a non-normalised mpn', part({ mpn: 'tps54331dr' })],
    ['an unknown category', part({ category: 'ldo' })],
    ['an empty manufacturer', part({ manufacturer: '' })],
    [
      'a missing parameters block',
      (() => {
        const { parameters: _parameters, ...rest } = part();
        return rest;
      })(),
    ],
    [
      'a parameter given as text',
      part({ parameters: buckParameters({ vinMax: param('3 V to 32 V') }) }),
    ],
    ['a bad offer', part({ offers: [offer({ moq: 0 })] })],
    ['a bad verification', part({ verifications: [verification({ page: 0 })] })],
    ['an extra key', part({ notes: 'x' })],
  ])('rejects %s', (_label, value) => {
    expectRejects(Part, value);
  });
});
