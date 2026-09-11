import { z } from 'zod';

/**
 * What a run is allowed to spend.
 *
 * Separate from the tools so a run can be configured without touching them:
 * the agent runner (M14) builds one of these per run, and the same tool
 * behaves differently under it without knowing why.
 */
export interface QuotaPolicy {
  /** Honour `confirmSpend: true` from the caller. False refuses every spend. */
  readonly allowConfirmedSpend: boolean;
  /**
   * Treat every call as confirmed. For a batch run that has already had its
   * budget approved, where asking per call would be asking the same question
   * a hundred times.
   */
  readonly autoConfirm: boolean;
}

/** Ask before spending, and spend when asked. */
export const DEFAULT_QUOTA_POLICY: QuotaPolicy = Object.freeze({
  allowConfirmedSpend: true,
  autoConfirm: false,
});

/** Spend nothing, whatever the caller says. */
export const NO_SPEND_POLICY: QuotaPolicy = Object.freeze({
  allowConfirmedSpend: false,
  autoConfirm: false,
});

export type SpendDecision = 'spend' | 'cache_only' | 'denied';

/**
 * Whether this call may spend.
 *
 * `cache_only` is not a refusal: the call runs against the cache, and only a
 * miss — a question that would cost something to answer — comes back as
 * `needs_confirmation`.
 */
export function spendDecision(
  policy: QuotaPolicy,
  confirmSpend: boolean | undefined,
): SpendDecision {
  if (policy.autoConfirm) {
    return 'spend';
  }
  if (confirmSpend === true) {
    return policy.allowConfirmedSpend ? 'spend' : 'denied';
  }
  return 'cache_only';
}

/** Input every spending tool accepts, on top of its own. */
export const SPEND_INPUT = {
  /**
   * Proceed even if the answer is not already cached. Without it the call is
   * answered from the cache or comes back as `needs_confirmation`.
   */
  confirmSpend: z.boolean().optional(),
} as const;

export const NeedsConfirmation = z.strictObject({
  status: z.literal('needs_confirmation'),
  tool: z.string(),
  reason: z.string(),
  /** Send the same input again with this merged in to go ahead. */
  retryWith: z.strictObject({ confirmSpend: z.literal(true) }),
});
export type NeedsConfirmation = z.output<typeof NeedsConfirmation>;

export const SpendDenied = z.strictObject({
  status: z.literal('denied'),
  tool: z.string(),
  reason: z.string(),
});
export type SpendDenied = z.output<typeof SpendDenied>;

/**
 * The output schema of a spending tool: its own result, or one of the two
 * answers that mean "this would have cost something".
 */
export function spendable<T extends z.ZodObject>(
  ok: T,
): z.ZodDiscriminatedUnion<
  [
    z.ZodObject<T['shape'] & { status: z.ZodLiteral<'ok'> }>,
    typeof NeedsConfirmation,
    typeof SpendDenied,
  ]
> {
  return z.discriminatedUnion('status', [
    ok.extend({ status: z.literal('ok') }),
    NeedsConfirmation,
    SpendDenied,
  ]);
}

export function needsConfirmation(tool: string, reason: string): NeedsConfirmation {
  return {
    status: 'needs_confirmation',
    tool,
    reason,
    retryWith: { confirmSpend: true },
  };
}

export function spendDenied(tool: string, reason: string): SpendDenied {
  return { status: 'denied', tool, reason };
}
