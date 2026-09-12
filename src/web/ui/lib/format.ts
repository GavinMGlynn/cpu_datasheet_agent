import { elementAt } from '../../../util/array.js';
import { label } from './labels.js';

/**
 * Turning stored values into what a page shows.
 *
 * Every function here is total: a value the schema allows but nobody
 * expected — a boolean where a quantity belongs, a null, an object of an
 * unknown shape — comes back as text rather than as a crash halfway down a
 * table.
 */

const SI: readonly { readonly factor: number; readonly prefix: string }[] = Object.freeze([
  { factor: 1e9, prefix: 'G' },
  { factor: 1e6, prefix: 'M' },
  { factor: 1e3, prefix: 'k' },
  { factor: 1, prefix: '' },
  { factor: 1e-3, prefix: 'm' },
  { factor: 1e-6, prefix: 'µ' },
  { factor: 1e-9, prefix: 'n' },
  { factor: 1e-12, prefix: 'p' },
]);

const UNIT_LABELS: Readonly<Record<string, string>> = Object.freeze({
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

export function unitLabel(unit: string): string {
  return UNIT_LABELS[unit] ?? unit;
}

/** A number with an SI prefix: 570000 Hz becomes 570 kHz, 7e-5 A becomes 70 µA. */
export function engineering(value: number, unit: string, significant = 3): string {
  const label = unitLabel(unit);
  if (value === 0) {
    return `0 ${label}`.trim();
  }
  if (unit === 'degC' || unit === 'percent' || unit === 'count') {
    return `${trim(value, significant)} ${label}`.trim();
  }
  const magnitude = Math.abs(value);
  // Smaller than a picofarad-sized number still gets the smallest prefix
  // rather than scientific notation: this is a datasheet, not a physics paper.
  const step = SI.find((one) => magnitude >= one.factor) ?? elementAt(SI, SI.length - 1);
  return `${trim(value / step.factor, significant)} ${step.prefix}${label}`.trim();
}

function trim(value: number, significant: number): string {
  const fixed = value.toPrecision(significant);
  return String(Number(fixed));
}

interface QuantityLike {
  readonly value: number;
  readonly unit: string;
}
interface RangeLike {
  readonly unit: string;
  readonly min?: number;
  readonly max?: number;
  readonly typ?: number;
}

function isQuantity(value: unknown): value is QuantityLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as QuantityLike).value === 'number' &&
    typeof (value as QuantityLike).unit === 'string'
  );
}

function isRange(value: unknown): value is RangeLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RangeLike).unit === 'string' &&
    (typeof (value as RangeLike).min === 'number' || typeof (value as RangeLike).max === 'number')
  );
}

/** Any stored parameter value, as one line of text. */
export function parameterValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'string') {
    // Stored vocabulary is snake_case; a page shows words.
    return label(value);
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (isQuantity(value)) {
    return engineering(value.value, value.unit);
  }
  if (isRange(value)) {
    const { unit, min, max, typ } = value;
    const ends = [
      min === undefined ? undefined : engineering(min, unit),
      max === undefined ? undefined : engineering(max, unit),
    ].filter((end): end is string => end !== undefined);
    const range =
      ends.length === 2
        ? ends.join(' to ')
        : `${min === undefined ? '≤ ' : '≥ '}${elementAt(ends, 0)}`;
    return typ === undefined ? range : `${range} (typ ${engineering(typ, unit)})`;
  }
  if (typeof value === 'object' && 'present' in value) {
    const soft = value as { present: boolean; time?: QuantityLike | null };
    const time = soft.time;
    return soft.present
      ? `Yes${time === null || time === undefined ? '' : ` (${engineering(time.value, time.unit)})`}`
      : 'No';
  }
  return JSON.stringify(value);
}

export function money(amount: number | null | undefined, currency = 'AUD'): string {
  if (amount === null || amount === undefined) {
    return '—';
  }
  const digits = Math.abs(amount) < 1 ? 3 : 2;
  return `${currency === 'USD' ? '$' : `${currency} `}${amount.toFixed(digits)}`;
}

export function usd(amount: number | null | undefined): string {
  return amount === null || amount === undefined ? '—' : `$${amount.toFixed(2)}`;
}

export function percent(fraction: number | null | undefined, digits = 1): string {
  return fraction === null || fraction === undefined ? '—' : `${(fraction * 100).toFixed(digits)}%`;
}

export function count(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : value.toLocaleString('en-AU');
}

/** A duration in milliseconds, as the shortest honest form. */
export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) {
    return '—';
  }
  if (ms < 1000) {
    return `${String(Math.round(ms))} ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)} s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${String(minutes)}m ${String(seconds)}s`;
}

/** An ISO timestamp as a local date and time, or a dash. */
export function when(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') {
    return '—';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toISOString().replace('T', ' ').slice(0, 16);
}

const RELATIVE = new Intl.RelativeTimeFormat('en-AU', { numeric: 'auto' });

const STEPS: readonly { readonly ms: number; readonly unit: Intl.RelativeTimeFormatUnit }[] =
  Object.freeze([
    { ms: 31_536_000_000, unit: 'year' },
    { ms: 2_592_000_000, unit: 'month' },
    { ms: 604_800_000, unit: 'week' },
    { ms: 86_400_000, unit: 'day' },
    { ms: 3_600_000, unit: 'hour' },
    { ms: 60_000, unit: 'minute' },
  ]);

/**
 * How long ago, in words: "3 hours ago", "yesterday", "2 months ago".
 *
 * A table of timestamps is a table nobody reads — the question a person
 * actually has is "recently, or not?". The exact instant is a hover away
 * ({@link exactly}), so nothing is lost by leading with the answer.
 */
export function relative(iso: string | null | undefined, now: Date = new Date()): string {
  if (iso === null || iso === undefined || iso === '') {
    return '—';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const difference = date.getTime() - now.getTime();
  const magnitude = Math.abs(difference);
  if (magnitude < 45_000) {
    return 'just now';
  }
  const step = STEPS.find((one) => magnitude >= one.ms) ?? elementAt(STEPS, STEPS.length - 1);
  return RELATIVE.format(Math.round(difference / step.ms), step.unit);
}

/**
 * The same instant in full, in whatever time zone the browser is in.
 *
 * This is what the relative form hangs on: the ledger is written in UTC, the
 * person reading it is not, and a run that started "at 11:03" means nothing
 * until it says 11:03 where.
 */
export function exactly(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString('en-AU', {
    dateStyle: 'full',
    timeStyle: 'long',
  });
}

export function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '—';
  }
  const units = ['B', 'kB', 'MB', 'GB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${elementAt(units, index)}`;
}

/** Short forms for the identifiers that fill tables: sessions, digests, ids. */
export function shortId(id: string | null | undefined, length = 8): string {
  return id === null || id === undefined || id === '' ? '—' : id.slice(0, length);
}

/**
 * What to show a person when something failed.
 *
 * A thrown value is not always an `Error` — a runtime can throw anything —
 * and a page that assumed otherwise would show "undefined".
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
