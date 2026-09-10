import { describe, expect, it } from 'vitest';

import { MpnError } from './errors.js';
import { isNormalisedMpn, normaliseMpn } from './normalise.js';

describe('normaliseMpn', () => {
  it('uppercases and keeps the original', () => {
    expect(normaliseMpn('tps54331dr')).toEqual({
      raw: 'tps54331dr',
      mpn: 'TPS54331DR',
      removed: [],
    });
  });

  it('removes whitespace anywhere in the part number', () => {
    expect(normaliseMpn('  TPS54331DR  ').mpn).toBe('TPS54331DR');
    expect(normaliseMpn('TPS 54331 DR').mpn).toBe('TPS54331DR');
    expect(normaliseMpn('MIC23051-16YML\tTR').mpn).toBe('MIC23051-16YMLTR');
    expect(normaliseMpn('LT8610AB\nEMSE#TRPBF').mpn).toBe('LT8610ABEMSE#TRPBF');
  });

  it('keeps the punctuation real part numbers use', () => {
    for (const mpn of [
      'LT8610ABEMSE-3.3#TRPBF',
      'MAX17503ATP+T',
      'MCP16331T-E/CH',
      'AP63203WU-7',
    ]) {
      expect(normaliseMpn(mpn).mpn).toBe(mpn);
    }
  });

  it('strips a Digi-Key part number back to the manufacturer part number', () => {
    expect(normaliseMpn('296-TPS54331DRCT-ND')).toEqual({
      raw: '296-TPS54331DRCT-ND',
      mpn: 'TPS54331DR',
      removed: ['distributor-prefix:296-', 'digikey-suffix:-ND', 'digikey-packaging:CT'],
    });
    expect(normaliseMpn('296-TPS54331DRTR-ND').mpn).toBe('TPS54331DR');
    expect(normaliseMpn('296-TPS54331DRDKR-ND').mpn).toBe('TPS54331DR');
  });

  it('strips a Mouser vendor prefix', () => {
    expect(normaliseMpn('595-TPS54331DR')).toEqual({
      raw: '595-TPS54331DR',
      mpn: 'TPS54331DR',
      removed: ['distributor-prefix:595-'],
    });
  });

  it('leaves a numeric prefix alone when what follows is not a part number', () => {
    // A Digi-Key stock number such as 1276-1002-1-ND is not an MPN with a
    // prefix, and inventing one from it would resolve to the wrong part.
    expect(normaliseMpn('1276-1002-1-ND').mpn).toBe('1276-1002-1');
  });

  it('keeps a packaging code that is the whole part number', () => {
    expect(normaliseMpn('CT-ND').mpn).toBe('CT');
  });

  it('rejects nothing to work with', () => {
    expect(() => normaliseMpn('   ')).toThrow(MpnError);
    expect(() => normaliseMpn('')).toThrow(
      expect.objectContaining({ code: 'MPN_EMPTY' }) as unknown,
    );
  });

  it('rejects characters no part number uses', () => {
    for (const raw of ['EVB_RT8279GSP', 'TPS54331<DR>', '(TPS54331DR)']) {
      expect(() => normaliseMpn(raw)).toThrow(
        expect.objectContaining({ code: 'MPN_INVALID' }) as unknown,
      );
    }
  });

  it('rejects a part number that starts with punctuation', () => {
    expect(() => normaliseMpn('-TPS54331')).toThrow(
      expect.objectContaining({ code: 'MPN_INVALID' }) as unknown,
    );
  });

  it('rejects anything longer than the schema allows', () => {
    expect(() => normaliseMpn('T'.repeat(65))).toThrow(
      expect.objectContaining({ code: 'MPN_TOO_LONG' }) as unknown,
    );
    expect(normaliseMpn('T'.repeat(64)).mpn).toHaveLength(64);
  });
});

describe('isNormalisedMpn', () => {
  it('accepts canonical part numbers and rejects everything else', () => {
    expect(isNormalisedMpn('TPS54331DR')).toBe(true);
    expect(isNormalisedMpn('tps54331dr')).toBe(false);
    expect(isNormalisedMpn('TPS 54331')).toBe(false);
    expect(isNormalisedMpn('')).toBe(false);
  });
});
