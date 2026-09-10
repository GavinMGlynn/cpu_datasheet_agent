/**
 * Text normalisation applied before any unit parsing. Pure and idempotent.
 *
 * - Unicode NFC, unicode minus to hyphen-minus, exotic spaces to plain spaces,
 *   runs of whitespace collapsed, ends trimmed.
 * - A sign separated from its digits (`- 40`) is joined (`-40`).
 * - Thousands separators in the form `1,500` are removed. A comma followed by
 *   anything other than exactly three digits is left alone and rejected later.
 * - `deg C`, `° C`, `V DC`, `A DC` are joined so a unit token has no spaces.
 */
export function normaliseText(text: string): string {
  let result = text
    .normalize('NFC')
    .replace(/−/g, '-')
    .replace(/[\u00A0\u2007\u2009\u202F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/([+-]) (?=[\d.])/g, '$1');
  let previous: string;
  do {
    previous = result;
    result = result.replace(/(\d),(\d{3})(?!\d)/g, '$1$2');
  } while (result !== previous);
  return result
    .replace(/\bdeg C\b/gi, 'degC')
    .replace(/° ?C\b/gi, '°C')
    .replace(/\b([VA]) ?DC\b/gi, '$1dc');
}

/** Strips a leading tolerance marker (`±`, `+/-`, `+-`) so the magnitude parses. */
export function stripToleranceSign(text: string): string {
  return text.replace(/^(?:±|\+\/-|\+-)\s*/, '');
}

/** Rewrites `3V3` style shorthand as `3.3V`. Only volts and amps are unambiguous. */
export function expandShorthand(text: string): string {
  return text.replace(/^(\d+)([VvAa])(\d+)$/, '$1.$3$2');
}
