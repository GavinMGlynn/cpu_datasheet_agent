import { CacheMissError } from '../cache/index.js';
import {
  needsConfirmation,
  spendDecision,
  spendDenied,
  type NeedsConfirmation,
  type SpendDenied,
} from './policy.js';
import type { ToolContext } from './types.js';

export type SpendOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly result: NeedsConfirmation | SpendDenied };

/** True for the error a cache-only call raises when nothing is stored. */
export function isCacheMiss(error: unknown): boolean {
  return error instanceof CacheMissError && error.code === 'CACHE_MISS';
}

/**
 * Runs the spending part of a tool under the run's policy.
 *
 * Unconfirmed, the work runs against the cache alone: an answer already on
 * disk is returned as usual, and only a question that would cost something
 * comes back as `needs_confirmation`. The caller never has to predict whether
 * something is cached, because the cache-only path runs the same code the
 * spending path runs.
 */
export async function withSpend<T>(
  tool: string,
  context: ToolContext,
  confirmSpend: boolean | undefined,
  run: (options: { readonly cacheOnly: boolean }) => Promise<T>,
): Promise<SpendOutcome<T>> {
  const decision = spendDecision(context.policy, confirmSpend);
  if (decision === 'denied') {
    return {
      ok: false,
      result: spendDenied(tool, 'this run is not allowed to spend quota, confirmed or not'),
    };
  }
  const cacheOnly = decision === 'cache_only';
  try {
    return { ok: true, value: await run({ cacheOnly }) };
  } catch (error) {
    if (cacheOnly && isCacheMiss(error)) {
      return {
        ok: false,
        result: needsConfirmation(
          tool,
          'the answer is not cached, so this call would spend distributor quota',
        ),
      };
    }
    throw error;
  }
}
