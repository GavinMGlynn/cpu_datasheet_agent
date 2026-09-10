import { ChipAgentError } from '../errors.js';

export class RegexGroupError extends ChipAgentError {}

/**
 * Reads a capture group the pattern guarantees will participate.
 *
 * `noUncheckedIndexedAccess` types every group as possibly undefined, which
 * would otherwise force an unreachable fallback at each use. This centralises
 * that check into one place that reports a real error, so a pattern edited to
 * make a group optional fails loudly instead of silently yielding `''`.
 *
 * Throws `RegexGroupError` (`REGEX_GROUP_MISSING`) when the group did not
 * participate or the index is out of range.
 */
export function group(match: RegExpExecArray, index: number): string {
  const value = match[index];
  if (value === undefined) {
    throw new RegexGroupError(
      'REGEX_GROUP_MISSING',
      `capture group ${String(index)} did not participate`,
      {
        details: { index, matched: match[0] },
      },
    );
  }
  return value;
}

/** Reads a capture group that the pattern may legitimately leave unfilled. */
export function optionalGroup(match: RegExpExecArray, index: number): string | undefined {
  return match[index];
}
