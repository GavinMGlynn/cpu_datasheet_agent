import type { Quantity, QuantityRange, Unit } from '../core/quantity.js';
import { ChipAgentError } from '../errors.js';
import { group, optionalGroup } from '../util/regex.js';
import { expandShorthand, normaliseText, stripToleranceSign } from './normalise.js';
import { resolveUnit, type ResolvedUnit } from './unit-table.js';

/** Thrown by every parser here. `details.text` is the input, `details.reason` the cause. */
export class ParseError extends ChipAgentError {}

export type ParseResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ParseError };

const NUMBER = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(.*)$/;
const EXPONENT = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;
const SEPARATOR = /\s*(?:\bto\b|~|…|\.{3}|–|—|\/)\s*/i;
const HYPHEN_BETWEEN = /(?<=[\d%°A-Za-zΩωΩ])(?<![eE])\s*-\s*(?=[+-]?[\d.])/g;
const TEMPERATURE_REFERENCE = /\(?\b(TJ|TA|T_J|T_A|junction|ambient)\b\)?/i;

function fail(text: string, reason: string, expectedUnit: Unit): ParseError {
  return new ParseError('UNIT_PARSE_FAILED', `cannot parse "${text}": ${reason}`, {
    details: { text, reason, expectedUnit },
  });
}

interface Token {
  readonly mantissa: string;
  readonly unitToken: string | null;
}

function tokenise(part: string, whole: string, expectedUnit: Unit): Token {
  const text = expandShorthand(stripToleranceSign(part.trim()));
  const match = NUMBER.exec(text);
  if (match === null) {
    throw fail(whole, `"${part}" does not start with a number`, expectedUnit);
  }
  const unitToken = group(match, 2).trim();
  return { mantissa: group(match, 1), unitToken: unitToken === '' ? null : unitToken };
}

/** Builds the number from its decimal text and a power of ten, without floating-point multiplication. */
export function scaleDecimal(mantissa: string, exponentShift: number): number {
  const match = EXPONENT.exec(mantissa);
  if (match === null) {
    return Number.NaN;
  }
  const sign = group(match, 1);
  const integer = group(match, 2);
  const fraction = optionalGroup(match, 3) ?? '';
  const explicitExponent = optionalGroup(match, 4);
  const exponent = (explicitExponent === undefined ? 0 : Number(explicitExponent)) + exponentShift;
  return Number(
    `${sign}${integer === '' ? '0' : integer}.${fraction === '' ? '0' : fraction}e${String(exponent)}`,
  );
}

function resolveToken(
  token: Token,
  whole: string,
  expectedUnit: Unit,
  inherited: ResolvedUnit | null,
): ResolvedUnit {
  if (token.unitToken === null) {
    if (inherited !== null) {
      return inherited;
    }
    if (expectedUnit === 'count') {
      return { unit: 'count', exponent: 0 };
    }
    throw fail(whole, `missing unit, expected ${expectedUnit}`, expectedUnit);
  }
  const resolved = resolveUnit(token.unitToken);
  if (resolved === null) {
    throw fail(whole, `unknown unit "${token.unitToken}"`, expectedUnit);
  }
  if (resolved.unit !== expectedUnit) {
    throw fail(whole, `expected ${expectedUnit}, found ${resolved.unit}`, expectedUnit);
  }
  return resolved;
}

function toValue(token: Token, resolved: ResolvedUnit, whole: string, expectedUnit: Unit): number {
  const value = scaleDecimal(token.mantissa, resolved.exponent);
  if (!Number.isFinite(value)) {
    throw fail(whole, `"${token.mantissa}" is not a finite number`, expectedUnit);
  }
  return value;
}

/** Splits range text on any recognised separator, including a hyphen between two values. */
export function splitRange(text: string): readonly string[] {
  return text.replace(HYPHEN_BETWEEN, ' ~ ').split(SEPARATOR);
}

/**
 * Parses a single quantity such as `3.3V`, `570 kHz`, `40 µA`, `-40°C`, `±2%`,
 * or `3V3` into the canonical unit. A string that is a range, has no unit
 * (unless `count` is expected), or carries any other unit is rejected.
 * Throws {@link ParseError}; never returns NaN.
 */
export function parseQuantity(text: string, expectedUnit: Unit): Quantity {
  const whole = stripToleranceSign(normaliseText(text));
  if (splitRange(whole).length !== 1) {
    throw fail(whole, 'looks like a range, not a single value', expectedUnit);
  }
  const token = tokenise(whole, whole, expectedUnit);
  const resolved = resolveToken(token, whole, expectedUnit, null);
  return { value: toValue(token, resolved, whole, expectedUnit), unit: expectedUnit };
}

/**
 * Parses `min to max` text such as `4.5V ~ 28V`, `3 to 32 V`, `100-200kHz`,
 * or `-40°C … +125°C`. A unit on one side applies to both. A single value is
 * never promoted to a range. Throws {@link ParseError}.
 */
export function parseRange(text: string, expectedUnit: Unit): QuantityRange {
  const whole = normaliseText(text);
  const parts = splitRange(whole);
  if (parts.length !== 2) {
    throw fail(
      whole,
      parts.length === 1 ? 'a single value is not a range' : 'more than two values',
      expectedUnit,
    );
  }
  const [left, right] = parts as [string, string];
  const leftToken = tokenise(left, whole, expectedUnit);
  const rightToken = tokenise(right, whole, expectedUnit);
  const rightUnit =
    rightToken.unitToken === null ? null : resolveToken(rightToken, whole, expectedUnit, null);
  const leftUnit = resolveToken(leftToken, whole, expectedUnit, rightUnit);
  const min = toValue(leftToken, leftUnit, whole, expectedUnit);
  const max = toValue(
    rightToken,
    resolveToken(rightToken, whole, expectedUnit, leftUnit),
    whole,
    expectedUnit,
  );
  if (min > max) {
    throw fail(whole, 'range is reversed', expectedUnit);
  }
  return { unit: expectedUnit, min, max };
}

export type TemperatureReference = 'junction' | 'ambient';

export interface TemperatureRange {
  readonly range: QuantityRange;
  /** From a `TJ`/`TA` (or `junction`/`ambient`) marker in the text, when present. */
  readonly reference: TemperatureReference | null;
}

/** Parses `-40°C ~ 125°C (TJ)` style text, extracting the reference marker. */
export function parseTemperatureRange(text: string): TemperatureRange {
  const whole = normaliseText(text);
  const marker = TEMPERATURE_REFERENCE.exec(whole);
  let reference: TemperatureReference | null = null;
  let rest = whole;
  if (marker !== null) {
    const word = group(marker, 1).toUpperCase();
    reference = word === 'TA' || word === 'T_A' || word === 'AMBIENT' ? 'ambient' : 'junction';
    rest = whole.replace(TEMPERATURE_REFERENCE, ' ');
  }
  return { range: parseRange(rest, 'degC'), reference };
}

function wrap<T>(run: () => T): ParseResult<T> {
  try {
    return { ok: true, value: run() };
  } catch (error) {
    if (error instanceof ParseError) {
      return { ok: false, error };
    }
    throw error;
  }
}

export function tryParseQuantity(text: string, expectedUnit: Unit): ParseResult<Quantity> {
  return wrap(() => parseQuantity(text, expectedUnit));
}

export function tryParseRange(text: string, expectedUnit: Unit): ParseResult<QuantityRange> {
  return wrap(() => parseRange(text, expectedUnit));
}

export function tryParseTemperatureRange(text: string): ParseResult<TemperatureRange> {
  return wrap(() => parseTemperatureRange(text));
}
