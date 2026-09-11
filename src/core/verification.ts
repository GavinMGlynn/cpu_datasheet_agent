import { z } from 'zod';

import { ParameterKey } from './parameter-keys.js';
import { Iso8601, PageNumber, PromptVersion } from './primitives.js';

export const VERDICTS = ['confirmed', 'contradicted', 'not_found'] as const;
export const Verdict = z.enum(VERDICTS);
export type Verdict = z.output<typeof Verdict>;

interface Quoted {
  readonly verdict: Verdict;
  readonly quote?: string | undefined;
}

interface Issuer {
  addIssue: (issue: { code: 'custom'; message: string; path: string[] }) => void;
}

/** `confirmed` and `contradicted` must quote the page; `not_found` must not. */
function quoteRule(verification: Quoted, ctx: Issuer): void {
  if (verification.verdict === 'not_found' && verification.quote !== undefined) {
    ctx.addIssue({
      code: 'custom',
      message: 'a not_found verdict cannot carry a quote',
      path: ['quote'],
    });
  }
  if (verification.verdict !== 'not_found' && verification.quote === undefined) {
    ctx.addIssue({
      code: 'custom',
      message: `a ${verification.verdict} verdict must quote the page`,
      path: ['quote'],
    });
  }
}

/**
 * What a verification run says about one parameter, before the run itself is
 * named.
 *
 * The reader states what it read and where; when it read it, and which prompt
 * and model did the reading, are facts about the run, and the tool fills them
 * in. A model asked to stamp its own timestamp is a model inventing one.
 */
export const VerificationClaim = z
  .strictObject({
    parameterKey: ParameterKey,
    verdict: Verdict,
    quote: z.string().trim().min(1).max(500).optional(),
    page: PageNumber,
  })
  .superRefine(quoteRule);
export type VerificationClaim = z.output<typeof VerificationClaim>;

/**
 * The outcome of checking one stored parameter against its cited page in a
 * fresh context, with the run that checked it.
 */
export const Verification = z
  .strictObject({
    parameterKey: ParameterKey,
    verdict: Verdict,
    quote: z.string().trim().min(1).max(500).optional(),
    page: PageNumber,
    checkedAt: Iso8601,
    promptVersion: PromptVersion,
    model: z.string().trim().min(1).max(64),
  })
  .superRefine(quoteRule);
export type Verification = z.output<typeof Verification>;
