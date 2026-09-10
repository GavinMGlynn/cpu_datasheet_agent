import type { Quantity, QuantityRange, Unit } from '../core/quantity.js';
import { MAX_PREFIX_EXPONENT, MIN_PREFIX_EXPONENT, UNIT_SYMBOLS, siPrefix } from './unit-table.js';

/**
 * Canonical text for a quantity: the shortest decimal that reads back to the
 * same number, followed by the unit symbol with no prefix. Guaranteed to
 * round-trip through `parseQuantity`.
 */
export function formatQuantity(quantity: Quantity): string {
  const symbol = UNIT_SYMBOLS[quantity.unit];
  return symbol === '' ? String(quantity.value) : `${String(quantity.value)} ${symbol}`;
}

/** Canonical text for a range: `min ~ max unit`, with `(typ value)` when present. */
export function formatRange(range: QuantityRange): string {
  const symbol = UNIT_SYMBOLS[range.unit];
  const suffix = symbol === '' ? '' : ` ${symbol}`;
  const typ = range.typ === undefined ? '' : ` (typ ${String(range.typ)}${suffix})`;
  return `${String(range.min)} ~ ${String(range.max)}${suffix}${typ}`;
}

const UNPREFIXED: ReadonlySet<Unit> = new Set<Unit>(['degC', 'percent', 'count']);

/**
 * Human-friendly engineering notation, for example `570 kHz` or `70 µA`, with
 * `significant` digits. Display only: it rounds and is not guaranteed to
 * round-trip exactly.
 */
export function formatEngineering(quantity: Quantity, significant = 4): string {
  const symbol = UNIT_SYMBOLS[quantity.unit];
  if (quantity.value === 0 || UNPREFIXED.has(quantity.unit)) {
    const plain = Number(quantity.value.toPrecision(significant));
    return symbol === '' ? String(plain) : `${String(plain)} ${symbol}`;
  }
  const magnitude = Math.floor(Math.log10(Math.abs(quantity.value)) / 3) * 3;
  const exponent = Math.min(MAX_PREFIX_EXPONENT, Math.max(MIN_PREFIX_EXPONENT, magnitude));
  const mantissa = Number((quantity.value / 10 ** exponent).toPrecision(significant));
  return `${String(mantissa)} ${siPrefix(exponent)}${symbol}`;
}
