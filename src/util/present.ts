import { ChipAgentError } from '../errors.js';

export class MissingValueError extends ChipAgentError {}

/**
 * Reads a value the caller has already proved is present.
 *
 * A schema that guarantees a field — a contradicted verdict quotes the page —
 * still types it as optional, and the alternative at each use is a fallback
 * that can never run and can never be tested (D23). This reports a real error
 * instead, so a guarantee that stops being true fails loudly and by name.
 */
export function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new MissingValueError('VALUE_MISSING', `expected ${what} to be present`, {
      details: { what },
    });
  }
  return value;
}
