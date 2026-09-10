import { describe, expect, it } from 'vitest';

import type { MpnCandidate } from './candidates.js';
import { decoderFor } from './decoders/index.js';
import { decodeQuery, relate, resolveMpn, type ResolveDeps } from './match.js';

function candidate(
  mpn: string,
  manufacturer = 'Texas Instruments',
  distributor: MpnCandidate['distributor'] = 'digikey',
): MpnCandidate {
  return {
    distributor,
    mpn,
    mpnAsListed: mpn,
    manufacturer,
    decoded: decoderFor(manufacturer)?.decode(mpn) ?? null,
    datasheetUrl: undefined,
    offers: [],
    siblings: [],
  };
}

let counter = 0;
const deps: ResolveDeps = {
  now: () => '2026-09-11T00:00:00.000Z',
  newId: () => {
    counter += 1;
    return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
  },
};

describe('relate', () => {
  const query = 'TPS54331DR';
  const decoded = decoderFor('Texas Instruments')?.decode(query) ?? null;

  it('calls an identical part number an exact match', () => {
    expect(relate(query, decoded, candidate('TPS54331DR'))).toBe('exact');
  });

  it('calls the same part on a different reel a packaging variant', () => {
    // TPS54331D is the same die in the same SOIC-8, shipped in a tube.
    expect(relate(query, decoded, candidate('TPS54331D'))).toBe('packaging_variant');
  });

  it('calls a different package a sibling, not a match', () => {
    expect(relate(query, decoded, candidate('TPS54331DDAR'))).toBe('sibling');
    expect(relate(query, decoded, candidate('TPS54331DDA'))).toBe('sibling');
  });

  it('calls a different device version a sibling', () => {
    expect(relate(query, decoded, candidate('TPS54331GDR'))).toBe('sibling');
  });

  it('calls an automotive part a sibling of the industrial one', () => {
    // Same package and base part, but qualification is not packaging.
    expect(relate(query, decoded, candidate('TPS54331QDRQ1'))).toBe('sibling');
  });

  it('calls a different family unrelated', () => {
    expect(relate(query, decoded, candidate('TPS54340DDAR'))).toBe('unrelated');
  });

  it('claims nothing when either part number is undecoded', () => {
    expect(relate(query, decoded, candidate('TPS54331EVM-232'))).toBe('unrelated');
    expect(relate(query, null, candidate('TPS54331DDAR'))).toBe('unrelated');
  });

  it('claims nothing across manufacturers', () => {
    const adi = decoderFor('Analog Devices Inc.')?.decode('LT8610EMSE#PBF') ?? null;
    expect(relate('LT8610EMSE#PBF', adi, candidate('TPS54331DDAR'))).toBe('unrelated');
  });

  it('compares a part with no grade against one with none', () => {
    const st = decoderFor('STMicroelectronics');
    const query1 = 'ST1S10PHR';
    expect(
      relate(query1, st?.decode(query1) ?? null, candidate('ST1S10PH', 'STMicroelectronics')),
    ).toBe('packaging_variant');
    expect(
      relate(query1, st?.decode(query1) ?? null, candidate('ST1S10PUR', 'STMicroelectronics')),
    ).toBe('sibling');
  });
});

describe('decodeQuery', () => {
  it('takes the decode from the exact listing when there is one', () => {
    const decoded = decodeQuery('TPS54331DR', [candidate('TPS54331DR')]);
    expect(decoded?.basePart).toBe('TPS54331');
  });

  it('tries the manufacturers of the listings when nothing matches exactly', () => {
    const decoded = decodeQuery('TPS54331DDAR', [candidate('TPS54331DR')]);
    expect(decoded?.package?.code).toBe('DDA');
  });

  it('returns null when no listing names a manufacturer that can read it', () => {
    expect(decodeQuery('XL4015E1', [candidate('TPS54331DR')])).toBeNull();
    expect(decodeQuery('TPS54331DR', [])).toBeNull();
  });

  it('ignores an exact listing that did not decode and still tries the manufacturer', () => {
    const undecodable: MpnCandidate = { ...candidate('TPS54331DR'), decoded: null };
    expect(decodeQuery('TPS54331DR', [undecodable])?.basePart).toBe('TPS54331');
  });
});

describe('resolveMpn', () => {
  it('resolves an exact listing and raises nothing', () => {
    const candidates = [
      candidate('TPS54331DDAR'),
      candidate('TPS54331DR'),
      candidate('TPS54331DR', 'Texas Instruments', 'mouser'),
    ];
    const resolution = resolveMpn('TPS54331DR', candidates, deps);
    expect(resolution.resolved?.mpn).toBe('TPS54331DR');
    expect(resolution.escalation).toBeNull();
    expect(resolution.decoded?.basePart).toBe('TPS54331');
  });

  it('orders the matches best first', () => {
    const resolution = resolveMpn(
      'TPS54331DR',
      [
        candidate('TPS54340DDAR'),
        candidate('TPS54331DDAR'),
        candidate('TPS54331D'),
        candidate('TPS54331DR'),
      ],
      deps,
    );
    expect(resolution.matches.map((match) => match.relation)).toEqual([
      'exact',
      'packaging_variant',
      'sibling',
      'unrelated',
    ]);
  });

  it('escalates when two manufacturers list the same part number', () => {
    const resolution = resolveMpn(
      'TPS54331DR',
      [candidate('TPS54331DR'), candidate('TPS54331DR', 'Some Other Semiconductor', 'mouser')],
      deps,
    );
    expect(resolution.resolved).toBeNull();
    expect(resolution.escalation).toMatchObject({ mpn: 'TPS54331DR', kind: 'ambiguous_mpn' });
    expect(resolution.escalation?.question).toContain('2 manufacturers');
    expect(resolution.escalation?.options).toEqual([
      'TPS54331DR — Texas Instruments (digikey)',
      'TPS54331DR — Some Other Semiconductor (mouser)',
    ]);
    expect(resolution.escalation?.context).toMatchObject({
      query: 'TPS54331DR',
      candidates: [
        { mpn: 'TPS54331DR', manufacturer: 'Texas Instruments', relation: 'exact' },
        { mpn: 'TPS54331DR', manufacturer: 'Some Other Semiconductor', relation: 'exact' },
      ],
    });
  });

  it('does not escalate when one manufacturer is listed by both distributors', () => {
    const resolution = resolveMpn(
      'TPS54331DR',
      [candidate('TPS54331DR'), candidate('TPS54331DR', 'texas instruments ', 'mouser')],
      deps,
    );
    expect(resolution.escalation).toBeNull();
    expect(resolution.resolved?.distributor).toBe('digikey');
  });

  it('escalates when nothing matches exactly and several siblings could be meant', () => {
    const resolution = resolveMpn(
      'TPS54331PWP',
      [candidate('TPS54331DDAR'), candidate('TPS54331DR'), candidate('TPS54331GDR')],
      deps,
    );
    expect(resolution.resolved).toBeNull();
    expect(resolution.escalation?.kind).toBe('ambiguous_mpn');
    expect(resolution.escalation?.question).toContain('No distributor lists TPS54331PWP');
    expect(resolution.escalation?.options).toHaveLength(3);
  });

  it('leaves a single sibling unresolved rather than escalating or guessing', () => {
    const resolution = resolveMpn('TPS54331PWP', [candidate('TPS54331DDAR')], deps);
    expect(resolution.resolved).toBeNull();
    expect(resolution.escalation).toBeNull();
    expect(resolution.matches.map((match) => match.relation)).toEqual(['sibling']);
  });

  it('counts one sibling listed by two distributors as one', () => {
    const resolution = resolveMpn(
      'TPS54331PWP',
      [candidate('TPS54331DDAR'), candidate('TPS54331DDAR', 'Texas Instruments', 'mouser')],
      deps,
    );
    expect(resolution.escalation).toBeNull();
  });

  it('resolves nothing when there are no candidates at all', () => {
    const resolution = resolveMpn('TPS54331DR', [], deps);
    expect(resolution).toMatchObject({
      query: 'TPS54331DR',
      decoded: null,
      matches: [],
      resolved: null,
      escalation: null,
    });
  });
});
