import { randomUUID } from 'node:crypto';

import { AuditDraft, type AuditEvent } from '../core/audit.js';
import { parseOrThrow } from '../core/validation-error.js';
import type { OpenSource } from './data/sources.js';

/**
 * The only way the browser changes anything.
 *
 * The change and the row that describes it are written in one transaction: a
 * correction stored without its reason, or a reason stored without its
 * correction, would each be worse than neither (D65).
 */

export interface AuditorOptions {
  readonly clock?: () => Date;
  readonly newId?: () => string;
}

export interface Change<T> {
  /** What the target looks like afterwards. Absent when the change removed it. */
  readonly after?: unknown;
  /** Whatever the caller wants back — the stored part, the resolved escalation. */
  readonly result: T;
}

export interface Audited<T> {
  readonly event: AuditEvent;
  readonly result: T;
}

export interface Auditor {
  around<T>(opened: OpenSource, draft: unknown, change: () => Change<T>): Audited<T>;
}

export function createAuditor(options: AuditorOptions = {}): Auditor {
  const clock = options.clock ?? ((): Date => new Date());
  const newId = options.newId ?? randomUUID;

  return {
    around(opened, draft, change) {
      const validated = parseOrThrow(AuditDraft, draft, 'AuditDraft');
      return opened.db.transaction(() => {
        const outcome = change();
        const event = opened.repositories.audit.record({
          ...validated,
          ...(outcome.after === undefined ? {} : { after: outcome.after }),
          id: newId(),
          at: clock().toISOString(),
        });
        return { event, result: outcome.result };
      });
    },
  };
}
