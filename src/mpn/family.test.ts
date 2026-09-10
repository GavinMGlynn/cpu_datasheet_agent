import { describe, expect, it } from 'vitest';

import type { PdfRef, SectionMatches } from '../pdf/toolkit.js';
import { decodeMpn } from './decoders/index.js';
import { isNormalisedMpn } from './normalise.js';
import {
  TOKEN,
  linkDatasheetFamily,
  orderingMpnsFrom,
  type FamilyToolkit,
  type PageTextLike,
} from './family.js';
import type { DecodedMpn } from './types.js';

const REF: PdfRef = { localPath: '/cache/tps54331.pdf', sha256: 'b'.repeat(64) };

function decoded(mpn: string, manufacturer = 'Texas Instruments'): DecodedMpn {
  const result = decodeMpn(mpn, manufacturer);
  if (result === null) {
    throw new Error(`the test needs ${mpn} to decode`);
  }
  return result;
}

const ORDERING_PAGE: PageTextLike = {
  page: 17,
  text: [
    'ORDERING INFORMATION',
    'ORDERABLE PART NUMBER   STATUS   PACKAGE   PINS   SPQ',
    'TPS54331DR              ACTIVE   SOIC (D)     8   2500',
    'TPS54331DDAR            ACTIVE   SO PowerPAD  8   2500',
    'TPS54331D               ACTIVE   SOIC (D)     8     75',
    'See the package drawing MPDS130 and document SLVS844F for details.',
  ].join('\n'),
};

describe('the token pattern', () => {
  it('only ever yields text that is already a canonical part number', () => {
    // This is what lets the scan skip normalisation: every token the pattern
    // finds, with a table rule or full stop trimmed, is one already.
    const text = [
      ORDERING_PAGE.text,
      'MPQ4323GDE-33-AEC1-P LT8610ABEMSE-3.3#TRPBF MAX17503ATP+T MCP16331T-E/CH',
      '|---TPS54331DR.| 1,500 kHz 4.5V~28V (c) 2021 Texas Instruments 6.35mm/0.25in',
    ].join('\n');
    const tokens = text.toUpperCase().match(TOKEN) ?? [];
    expect(tokens.length).toBeGreaterThan(20);
    for (const token of tokens) {
      expect(isNormalisedMpn(token.replace(/[-./]+$/, '')), token).toBe(true);
    }
  });
});

describe('orderingMpnsFrom', () => {
  it('finds the part numbers of the reference part family', () => {
    expect(orderingMpnsFrom([ORDERING_PAGE], decoded('TPS54331DR'))).toEqual([
      { mpn: 'TPS54331DR', page: 17 },
      { mpn: 'TPS54331DDAR', page: 17 },
      { mpn: 'TPS54331D', page: 17 },
    ]);
  });

  it('leaves out anything that is not a part number of this family', () => {
    const noisy: PageTextLike = {
      page: 2,
      text: [
        'TPS54340DDAR is the 3.5 A device in the same series.',
        'Compare with MP2315GJ-Z from another vendor.',
        'Document SLVS844F, revised December 2021.',
        'Package drawing MPDS130A.',
      ].join('\n'),
    };
    expect(orderingMpnsFrom([noisy], decoded('TPS54331DR'))).toEqual([]);
  });

  it('reads a part number out of a table rule or the end of a sentence', () => {
    const page: PageTextLike = {
      page: 3,
      text: '|TPS54331DDAR.| ---TPS54331D--- and tps54331dr/',
    };
    expect(orderingMpnsFrom([page], decoded('TPS54331DR')).map((found) => found.mpn)).toEqual([
      'TPS54331DDAR',
      'TPS54331D',
      'TPS54331DR',
    ]);
  });

  it('records the page a part number was first seen on', () => {
    const pages: PageTextLike[] = [
      { page: 4, text: 'TPS54331DR' },
      { page: 9, text: 'TPS54331DR and TPS54331DDAR' },
    ];
    expect(orderingMpnsFrom(pages, decoded('TPS54331DR'))).toEqual([
      { mpn: 'TPS54331DR', page: 4 },
      { mpn: 'TPS54331DDAR', page: 9 },
    ]);
  });

  it('finds nothing on a page with nothing on it', () => {
    expect(orderingMpnsFrom([{ page: 1, text: '' }], decoded('TPS54331DR'))).toEqual([]);
    expect(orderingMpnsFrom([], decoded('TPS54331DR'))).toEqual([]);
  });

  it('uses the reference part own decoder, so a family is one manufacturer', () => {
    const page: PageTextLike = { page: 1, text: 'ST1S10PHR ST1S10PUR TPS54331DR' };
    expect(
      orderingMpnsFrom([page], decoded('ST1S10PHR', 'STMicroelectronics')).map((f) => f.mpn),
    ).toEqual(['ST1S10PHR', 'ST1S10PUR']);
  });
});

interface Recorded {
  readonly sha256: string;
  readonly mpn: string;
}

function toolkitFor(
  sections: SectionMatches,
  pages: readonly PageTextLike[],
): { toolkit: FamilyToolkit; asked: number[][] } {
  const asked: number[][] = [];
  return {
    asked,
    toolkit: {
      findPages: () => Promise.resolve(sections),
      readPages: (_ref: PdfRef, requested: readonly number[]) => {
        asked.push([...requested]);
        return Promise.resolve(pages);
      },
    },
  };
}

describe('linkDatasheetFamily', () => {
  it('links every part number the ordering table lists', async () => {
    const linked: Recorded[] = [];
    const { toolkit, asked } = toolkitFor(
      { orderingInformation: [{ page: 17, line: 'ORDERING INFORMATION' }] },
      [ORDERING_PAGE],
    );
    const result = await linkDatasheetFamily(
      { toolkit, datasheets: { linkMpn: (sha256, mpn) => linked.push({ sha256, mpn }) } },
      REF,
      decoded('TPS54331DR'),
    );
    expect(asked).toEqual([[17]]);
    expect(result).toEqual({
      sha256: REF.sha256,
      family: 'TPS54331',
      pages: [17],
      mpns: [
        { mpn: 'TPS54331DR', page: 17 },
        { mpn: 'TPS54331DDAR', page: 17 },
        { mpn: 'TPS54331D', page: 17 },
      ],
    });
    expect(linked).toEqual([
      { sha256: REF.sha256, mpn: 'TPS54331DR' },
      { sha256: REF.sha256, mpn: 'TPS54331DDAR' },
      { sha256: REF.sha256, mpn: 'TPS54331D' },
    ]);
  });

  it('reads every ordering page, not only the first', async () => {
    const { toolkit, asked } = toolkitFor(
      {
        orderingInformation: [
          { page: 17, line: 'ORDERING INFORMATION' },
          { page: 18, line: 'ORDERING INFORMATION (continued)' },
        ],
      },
      [ORDERING_PAGE],
    );
    await linkDatasheetFamily(
      { toolkit, datasheets: { linkMpn: () => undefined } },
      REF,
      decoded('TPS54331DR'),
    );
    expect(asked).toEqual([[17, 18]]);
  });

  it('reads nothing when the datasheet has no ordering section', async () => {
    for (const sections of [{ orderingInformation: [] }, {}] as SectionMatches[]) {
      const { toolkit, asked } = toolkitFor(sections, [ORDERING_PAGE]);
      const linked: Recorded[] = [];
      const result = await linkDatasheetFamily(
        { toolkit, datasheets: { linkMpn: (sha256, mpn) => linked.push({ sha256, mpn }) } },
        REF,
        decoded('TPS54331DR'),
      );
      expect(result).toEqual({
        sha256: REF.sha256,
        family: 'TPS54331',
        pages: [],
        mpns: [],
      });
      expect(asked).toEqual([]);
      expect(linked).toEqual([]);
    }
  });
});
