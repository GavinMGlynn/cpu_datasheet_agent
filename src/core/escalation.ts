import { z } from 'zod';

import { Iso8601, NormalisedMpn } from './primitives.js';

export const ESCALATION_KINDS = [
  'ambiguous_mpn',
  'conflict',
  'unreadable_safety_rating',
  'other',
] as const;
export const EscalationKind = z.enum(ESCALATION_KINDS);
export type EscalationKind = z.output<typeof EscalationKind>;

export const EscalationResolution = z.strictObject({
  answer: z.string().trim().min(1).max(2000),
  resolvedAt: Iso8601,
  by: z.string().trim().min(1).max(128),
});
export type EscalationResolution = z.output<typeof EscalationResolution>;

/** A question the agent could not answer safely and handed to a person. */
export const Escalation = z
  .strictObject({
    id: z.uuid(),
    mpn: NormalisedMpn,
    kind: EscalationKind,
    question: z.string().trim().min(1).max(2000),
    /** JSON-serialisable context: candidates, conflicting values, page numbers. */
    context: z.record(z.string(), z.json()),
    options: z.array(z.string().trim().min(1).max(500)).min(2).optional(),
    createdAt: Iso8601,
    resolution: EscalationResolution.optional(),
  })
  .superRefine((escalation, ctx) => {
    if (
      escalation.resolution !== undefined &&
      Date.parse(escalation.resolution.resolvedAt) < Date.parse(escalation.createdAt)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'resolvedAt cannot be earlier than createdAt',
        path: ['resolution', 'resolvedAt'],
      });
    }
  });
export type Escalation = z.output<typeof Escalation>;
