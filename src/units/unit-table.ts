import type { Unit } from '../core/quantity.js';
import { ChipAgentError } from '../errors.js';

export class UnitRangeError extends ChipAgentError {}

/** Display symbol for each canonical unit. */
export const UNIT_SYMBOLS: Readonly<Record<Unit, string>> = Object.freeze({
  V: 'V',
  A: 'A',
  Hz: 'Hz',
  s: 's',
  Ohm: 'Ω',
  W: 'W',
  degC: '°C',
  percent: '%',
  count: '',
});

/** Lower-cased unit spellings accepted from datasheets and distributors. */
const ALIASES: Readonly<Record<string, Unit>> = Object.freeze({
  v: 'V',
  volt: 'V',
  volts: 'V',
  vdc: 'V',
  a: 'A',
  amp: 'A',
  amps: 'A',
  ampere: 'A',
  amperes: 'A',
  adc: 'A',
  hz: 'Hz',
  hertz: 'Hz',
  s: 's',
  sec: 's',
  secs: 's',
  second: 's',
  seconds: 's',
  ohm: 'Ohm',
  ohms: 'Ohm',
  ω: 'Ohm',
  w: 'W',
  watt: 'W',
  watts: 'W',
  '°c': 'degC',
  '℃': 'degC',
  degc: 'degC',
  c: 'degC',
  '%': 'percent',
  percent: 'percent',
  pct: 'percent',
});

/** SI prefixes as powers of ten. Case matters (`m` milli, `M` mega) except for kilo. */
const PREFIXES: Readonly<Record<string, number>> = Object.freeze({
  p: -12,
  n: -9,
  µ: -6,
  μ: -6,
  u: -6,
  m: -3,
  k: 3,
  K: 3,
  M: 6,
  G: 9,
});

/** Units that never take a prefix. */
const UNPREFIXED: ReadonlySet<Unit> = new Set<Unit>(['degC', 'percent', 'count']);

export interface ResolvedUnit {
  readonly unit: Unit;
  /** Power of ten contributed by the prefix. */
  readonly exponent: number;
}

/**
 * Resolves a unit token such as `kHz`, `mV`, `µA`, `mΩ`, `°C`, `%`, or `Vdc`
 * to a canonical unit and prefix exponent. Returns null for anything else.
 */
export function resolveUnit(token: string): ResolvedUnit | null {
  const lower = token.toLowerCase();
  const direct = ALIASES[lower];
  if (direct !== undefined) {
    return { unit: direct, exponent: 0 };
  }
  const prefix = token.charAt(0);
  const exponent = PREFIXES[prefix];
  if (exponent === undefined) {
    return null;
  }
  const rest = ALIASES[token.slice(1).toLowerCase()];
  if (rest === undefined || UNPREFIXED.has(rest)) {
    return null;
  }
  return { unit: rest, exponent };
}

/** SI prefix symbols by power of ten, for display. */
const PREFIX_BY_EXPONENT: ReadonlyMap<number, string> = new Map([
  [-12, 'p'],
  [-9, 'n'],
  [-6, 'µ'],
  [-3, 'm'],
  [0, ''],
  [3, 'k'],
  [6, 'M'],
  [9, 'G'],
]);

/** Smallest and largest exponents `siPrefix` accepts. */
export const MIN_PREFIX_EXPONENT = -12;
export const MAX_PREFIX_EXPONENT = 9;

/**
 * Prefix symbol for a power of ten. The exponent must be a multiple of three
 * between {@link MIN_PREFIX_EXPONENT} and {@link MAX_PREFIX_EXPONENT}; anything
 * else throws, so a formatter that miscomputes its exponent fails loudly
 * instead of dropping the prefix.
 */
export function siPrefix(exponent: number): string {
  const symbol = PREFIX_BY_EXPONENT.get(exponent);
  if (symbol === undefined) {
    throw new UnitRangeError(
      'UNIT_PREFIX_OUT_OF_RANGE',
      `no SI prefix for exponent ${String(exponent)}`,
      {
        details: { exponent },
      },
    );
  }
  return symbol;
}
