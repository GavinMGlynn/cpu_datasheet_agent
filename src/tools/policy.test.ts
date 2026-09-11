import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  DEFAULT_QUOTA_POLICY,
  NO_SPEND_POLICY,
  needsConfirmation,
  spendDecision,
  spendDenied,
  spendable,
} from './policy.js';

describe('spendDecision', () => {
  it.each([
    ['asks when nothing is confirmed', DEFAULT_QUOTA_POLICY, undefined, 'cache_only'],
    ['spends when the caller confirms', DEFAULT_QUOTA_POLICY, true, 'spend'],
    ['asks when the caller says false', DEFAULT_QUOTA_POLICY, false, 'cache_only'],
    ['refuses a confirmed spend under a no-spend policy', NO_SPEND_POLICY, true, 'denied'],
    [
      'still answers from the cache under a no-spend policy',
      NO_SPEND_POLICY,
      undefined,
      'cache_only',
    ],
  ])('%s', (_label, policy, confirmSpend, expected) => {
    expect(spendDecision(policy, confirmSpend)).toBe(expected);
  });

  it('spends without asking when the run has already been approved', () => {
    const approved = { allowConfirmedSpend: true, autoConfirm: true };
    expect(spendDecision(approved, undefined)).toBe('spend');
    expect(spendDecision(approved, false)).toBe('spend');
  });
});

describe('spendable', () => {
  const schema = spendable(z.strictObject({ answer: z.number() }));

  it('accepts the result, a request to confirm, and a refusal', () => {
    expect(schema.parse({ status: 'ok', answer: 42 })).toEqual({ status: 'ok', answer: 42 });
    expect(schema.parse(needsConfirmation('a_tool', 'because'))).toEqual({
      status: 'needs_confirmation',
      tool: 'a_tool',
      reason: 'because',
      retryWith: { confirmSpend: true },
    });
    expect(schema.parse(spendDenied('a_tool', 'no'))).toEqual({
      status: 'denied',
      tool: 'a_tool',
      reason: 'no',
    });
  });

  it('rejects a result that says nothing about which it is', () => {
    expect(schema.safeParse({ answer: 42 }).success).toBe(false);
  });
});
