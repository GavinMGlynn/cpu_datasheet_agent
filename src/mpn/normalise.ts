import { NormalisedMpn } from '../core/primitives.js';
import { MpnError } from './errors.js';

/** Digi-Key adds a packaging code and `-ND` to the manufacturer's number. */
const DIGIKEY_SUFFIX = '-ND';
const DIGIKEY_PACKAGING_SUFFIX = /(?:CT|TR|DKR)$/;
/** Both Digi-Key and Mouser prefix their own number with a vendor code. */
const DISTRIBUTOR_PREFIX = /^\d{2,4}-(?=[A-Z])/;
const MAX_LENGTH = 64;

export interface NormalisedMpnResult {
  /** Exactly what the caller passed, so the source text is never lost. */
  readonly raw: string;
  /** Uppercase, no whitespace, no distributor decoration. */
  readonly mpn: string;
  /** What was removed, as `reason:text`, so a wrong strip is visible. */
  readonly removed: readonly string[];
}

/**
 * Canonicalises a part number as a source gave it.
 *
 * Whitespace is removed rather than collapsed, because the canonical form
 * holds none: a part number split across a line break in a datasheet table is
 * the same part number. Distributor decoration is removed only in the shapes
 * both distributors are known to use, since a vendor prefix and a real part
 * number look alike, and stripping the wrong one invents a part.
 *
 * Throws `MpnError`: `MPN_EMPTY` for nothing to work with, `MPN_TOO_LONG`
 * past 64 characters, `MPN_INVALID` when the result still holds characters no
 * part number uses.
 */
export function normaliseMpn(raw: string): NormalisedMpnResult {
  const removed: string[] = [];
  const collapsed = raw.replace(/\s+/g, '').toUpperCase();
  if (collapsed === '') {
    throw new MpnError('MPN_EMPTY', 'the part number is empty', { details: { raw } });
  }

  let mpn = collapsed;
  const prefix = DISTRIBUTOR_PREFIX.exec(mpn);
  if (prefix !== null) {
    removed.push(`distributor-prefix:${prefix[0]}`);
    mpn = mpn.slice(prefix[0].length);
  }
  if (mpn.endsWith(DIGIKEY_SUFFIX)) {
    removed.push(`digikey-suffix:${DIGIKEY_SUFFIX}`);
    mpn = mpn.slice(0, -DIGIKEY_SUFFIX.length);
    const packaging = DIGIKEY_PACKAGING_SUFFIX.exec(mpn);
    // Only when something is left: `CT-ND` alone is not a part number.
    if (packaging !== null && mpn.length > packaging[0].length) {
      removed.push(`digikey-packaging:${packaging[0]}`);
      mpn = mpn.slice(0, mpn.length - packaging[0].length);
    }
  }

  if (mpn.length > MAX_LENGTH) {
    throw new MpnError(
      'MPN_TOO_LONG',
      `the part number is ${String(mpn.length)} characters, over the ${String(MAX_LENGTH)} allowed`,
      { details: { raw, mpn } },
    );
  }
  const parsed = NormalisedMpn.safeParse(mpn);
  if (!parsed.success) {
    throw new MpnError('MPN_INVALID', `"${raw}" does not normalise to a part number`, {
      details: { raw, mpn },
    });
  }
  return { raw, mpn: parsed.data, removed };
}

/** True when the text is already in canonical form. */
export function isNormalisedMpn(text: string): boolean {
  return NormalisedMpn.safeParse(text).success;
}
