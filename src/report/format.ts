import type { ObservedValue } from '../core/observation.js';
import type { Provenance } from '../core/provenance.js';
import { isQuantity, isRange, isSoftStart } from '../core/value-shapes.js';
import { formatEngineering, formatRange } from '../units/index.js';

/** Text shown when a datasheet does not state a value. */
export const NOT_STATED = 'not stated';

/**
 * Renders a parameter value for reading.
 *
 * Quantities use engineering notation (`570 kHz`, not `570000 Hz`) because the
 * report is read by a person comparing against a datasheet, which is also how
 * datasheets write them. This is display only; the stored value is canonical.
 */
export function formatParameterValue(value: unknown): string {
  if (value === null) {
    return NOT_STATED;
  }
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (isSoftStart(value)) {
    if (!value.present) {
      return 'no';
    }
    return value.time === null ? 'yes' : `yes, ${formatEngineering(value.time as never)}`;
  }
  if (isQuantity(value)) {
    return formatEngineering(value as never);
  }
  if (isRange(value)) {
    return formatRange(value as never);
  }
  return JSON.stringify(value);
}

/**
 * Renders a distributor's stated value, including the bound kinds: `Up to
 * 1MHz` is recorded as a maximum, and showing it as a plain number would
 * turn a limit into a measurement.
 */
export function formatObservedValue(observed: ObservedValue): string {
  switch (observed.kind) {
    case 'max':
      return `at most ${formatParameterValue(observed.value)}`;
    case 'min':
      return `at least ${formatParameterValue(observed.value)}`;
    case 'quantity':
    case 'range':
    case 'enum':
    case 'boolean':
    case 'text':
      return formatParameterValue(observed.value);
  }
}

/** A short description of where a value came from. */
export function formatProvenance(provenance: Provenance): string {
  switch (provenance.source) {
    case 'datasheet':
      return `datasheet page ${String(provenance.page)} (${provenance.method})`;
    case 'distributor':
      return `${provenance.distributor} ${provenance.sku}`;
    case 'human':
      return `recorded by hand: ${provenance.note}`;
    case 'derived':
      return `derived by ${provenance.rule} from ${provenance.from.join(', ')}`;
  }
}

/** The cited page, when the value came from a datasheet. */
export function citedPage(provenance: Provenance): number | undefined {
  return provenance.source === 'datasheet' ? provenance.page : undefined;
}

/** The quoted text, when the extraction recorded one. */
export function citedQuote(provenance: Provenance): string | undefined {
  return provenance.source === 'datasheet' ? provenance.quote : undefined;
}

/** Money for display, to the cent, with the currency after it. */
export function formatPrice(unitPrice: number, currency: string): string {
  return `${unitPrice.toFixed(unitPrice < 1 ? 4 : 2)} ${currency}`;
}
