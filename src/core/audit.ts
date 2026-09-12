import { z } from 'zod';

import { Iso8601 } from './primitives.js';

/**
 * What a change was made to.
 *
 * The kinds are deliberately coarse: this is a record of human intervention,
 * and the question it answers is "who changed what, and why", not "which
 * column".
 */
export const AUDIT_TARGETS = ['part', 'parameter', 'escalation', 'golden', 'cache'] as const;
export const AuditTarget = z.enum(AUDIT_TARGETS);
export type AuditTarget = z.output<typeof AuditTarget>;

/**
 * One change made by a person, with what it replaced.
 *
 * The ledger exists because a tool call that is not recorded cannot be
 * reconstructed. A hand edit is no different, and is more dangerous, because
 * nothing else witnesses it: the model's own work leaves a transcript, and a
 * correction leaves nothing unless this row is written (D65).
 *
 * `reason` is not optional. A value changed without one is a value nobody can
 * defend six months later.
 */
export const AuditEvent = z.strictObject({
  id: z.uuid(),
  at: Iso8601,
  /** Who made the change. The site records whoever the browser says it is. */
  actor: z.string().trim().min(1).max(120),
  /** A dotted name, such as `parameter.correct`, so events group by kind. */
  action: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/u, { error: 'expected a dotted action name' })
    .max(64),
  targetKind: AuditTarget,
  /** What was changed: an MPN, an MPN and a parameter key, an escalation id. */
  targetId: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(3).max(2000),
  /** The value before the change, absent when nothing was there. */
  before: z.json().optional(),
  /** The value after, absent when the change was a deletion. */
  after: z.json().optional(),
});
export type AuditEvent = z.output<typeof AuditEvent>;

/** An event as a caller states it: everything except when and which. */
export const AuditDraft = AuditEvent.omit({ id: true, at: true });
export type AuditDraft = z.output<typeof AuditDraft>;
