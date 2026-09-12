import { AuditEvent, type AuditTarget } from '../core/audit.js';
import { parseOrThrow } from '../core/validation-error.js';
import { DbError, type Db } from './database.js';
import { parseJson } from './json.js';

interface AuditRow {
  id: string;
  at: string;
  actor: string;
  action: string;
  target_kind: string;
  target_id: string;
  reason: string;
  before_json: string | null;
  after_json: string | null;
}

/** Optional fields accept an explicit `undefined`; see `EscalationFilter`. */
export interface AuditFilter {
  readonly targetKind?: AuditTarget | undefined;
  readonly targetId?: string | undefined;
  readonly action?: string | undefined;
  readonly actor?: string | undefined;
  readonly limit?: number | undefined;
}

const COLUMNS = 'id, at, actor, action, target_kind, target_id, reason, before_json, after_json';

function hydrate(row: AuditRow): AuditEvent {
  return parseOrThrow(
    AuditEvent,
    {
      id: row.id,
      at: row.at,
      actor: row.actor,
      action: row.action,
      targetKind: row.target_kind,
      targetId: row.target_id,
      reason: row.reason,
      ...(row.before_json === null ? {} : { before: parseJson(row.before_json) }),
      ...(row.after_json === null ? {} : { after: parseJson(row.after_json) }),
    },
    `stored AuditEvent ${row.id}`,
  );
}

/**
 * The record of every change made by hand.
 *
 * Append-only by design: there is no update and no delete. A row that turned
 * out to be wrong is corrected by another row, which is the only version of
 * events a reader can trust.
 */
export class AuditRepository {
  constructor(private readonly db: Db) {}

  record(input: unknown): AuditEvent {
    const event = parseOrThrow(AuditEvent, input, 'AuditEvent');
    try {
      this.db.raw
        .prepare<
          [string, string, string, string, string, string, string, string | null, string | null]
        >(`INSERT INTO audit_events (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          event.id,
          event.at,
          event.actor,
          event.action,
          event.targetKind,
          event.targetId,
          event.reason,
          event.before === undefined ? null : JSON.stringify(event.before),
          event.after === undefined ? null : JSON.stringify(event.after),
        );
    } catch (error) {
      throw new DbError('DB_DUPLICATE_AUDIT_EVENT', `audit event ${event.id} already exists`, {
        cause: error,
        details: { id: event.id },
      });
    }
    return event;
  }

  get(id: string): AuditEvent | undefined {
    const row = this.db.raw
      .prepare<[string], AuditRow>(`SELECT ${COLUMNS} FROM audit_events WHERE id = ?`)
      .get(id);
    return row === undefined ? undefined : hydrate(row);
  }

  /** Most recent first. */
  list(filter: AuditFilter = {}): AuditEvent[] {
    const clauses: string[] = [];
    const values: string[] = [];
    if (filter.targetKind !== undefined) {
      clauses.push('target_kind = ?');
      values.push(filter.targetKind);
    }
    if (filter.targetId !== undefined) {
      clauses.push('target_id = ?');
      values.push(filter.targetId);
    }
    if (filter.action !== undefined) {
      clauses.push('action = ?');
      values.push(filter.action);
    }
    if (filter.actor !== undefined) {
      clauses.push('actor = ?');
      values.push(filter.actor);
    }
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`;
    const limit = filter.limit ?? 200;
    return this.db.raw
      .prepare<string[], AuditRow>(
        `SELECT ${COLUMNS} FROM audit_events${where} ORDER BY at DESC, rowid DESC LIMIT ${String(limit)}`,
      )
      .all(...values)
      .map(hydrate);
  }
}
