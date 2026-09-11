import { z } from 'zod';

import { ParameterKey } from './parameter-keys.js';
import { Iso8601, PageNumber, PromptVersion } from './primitives.js';

export const VERDICTS = ['confirmed', 'contradicted', 'not_found'] as const;
export const Verdict = z.enum(VERDICTS);
export type Verdict = z.output<typeof Verdict>;

/**
 * The outcome of checking one stored parameter against its cited page in a
 * fresh context. `confirmed` and `contradicted` must quote the page;
 * `not_found` must not.
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
  .superRefine((verification, ctx) => {
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
  });
export type Verification = z.output<typeof Verification>;
