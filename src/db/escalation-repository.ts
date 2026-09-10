import { Escalation, type EscalationKind } from '../core/escalation.js';
import { parseOrThrow } from '../core/validation-error.js';
import { DbError, type Db } from './database.js';
import { parseJson } from './json.js';

interface EscalationRow {
  id: string;
  mpn: string;
  kind: string;
  question: string;
  context_json: string;
  options_json: string | null;
  created_at: string;
  resolution_json: string | null;
}

export interface EscalationFilter {
  readonly mpn?: string;
  readonly kind?: EscalationKind;
  /** true: only resolved; false: only open; omitted: both. */
  readonly resolved?: boolean;
}

function hydrate(row: EscalationRow): Escalation {
  return parseOrThrow(
    Escalation,
    {
      id: row.id,
      mpn: row.mpn,
      kind: row.kind,
      question: row.question,
      context: parseJson(row.context_json),
      ...(row.options_json === null ? {} : { options: parseJson(row.options_json) }),
      createdAt: row.created_at,
      ...(row.resolution_json === null ? {} : { resolution: parseJson(row.resolution_json) }),
    },
    `stored Escalation ${row.id}`,
  );
}

const COLUMNS = 'id, mpn, kind, question, context_json, options_json, created_at, resolution_json';

export class EscalationRepository {
  constructor(private readonly db: Db) {}

  create(input: unknown): Escalation {
    const escalation = parseOrThrow(Escalation, input, 'Escalation');
    try {
      this.db.raw
        .prepare<[string, string, string, string, string, string | null, string, string | null]>(
          `INSERT INTO escalations (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          escalation.id,
          escalation.mpn,
          escalation.kind,
          escalation.question,
          JSON.stringify(escalation.context),
          escalation.options === undefined ? null : JSON.stringify(escalation.options),
          escalation.createdAt,
          escalation.resolution === undefined ? null : JSON.stringify(escalation.resolution),
        );
    } catch (error) {
      throw new DbError('DB_DUPLICATE_ESCALATION', `escalation ${escalation.id} already exists`, {
        cause: error,
        details: { id: escalation.id },
      });
    }
    return escalation;
  }

  get(id: string): Escalation | undefined {
    const row = this.db.raw
      .prepare<[string], EscalationRow>(`SELECT ${COLUMNS} FROM escalations WHERE id = ?`)
      .get(id);
    return row === undefined ? undefined : hydrate(row);
  }

  list(filter: EscalationFilter = {}): Escalation[] {
    const clauses: string[] = [];
    const params: (string | null)[] = [];
    if (filter.mpn !== undefined) {
      clauses.push('mpn = ?');
      params.push(filter.mpn);
    }
    if (filter.kind !== undefined) {
      clauses.push('kind = ?');
      params.push(filter.kind);
    }
    if (filter.resolved !== undefined) {
      clauses.push(filter.resolved ? 'resolution_json IS NOT NULL' : 'resolution_json IS NULL');
    }
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`;
    return this.db.raw
      .prepare<(string | null)[], EscalationRow>(
        `SELECT ${COLUMNS} FROM escalations${where} ORDER BY created_at, id`,
      )
      .all(...params)
      .map(hydrate);
  }

  listOpen(mpn?: string): Escalation[] {
    return this.list({ resolved: false, ...(mpn === undefined ? {} : { mpn }) });
  }

  /** Records who answered, and when. An escalation can be resolved once. */
  resolve(id: string, resolution: unknown): Escalation {
    const existing = this.get(id);
    if (existing === undefined) {
      throw new DbError('DB_ESCALATION_NOT_FOUND', `no escalation with id ${id}`, {
        details: { id },
      });
    }
    if (existing.resolution !== undefined) {
      throw new DbError('DB_ESCALATION_ALREADY_RESOLVED', `escalation ${id} is already resolved`, {
        details: { id },
      });
    }
    const resolved = parseOrThrow(
      Escalation,
      { ...existing, resolution },
      `Escalation ${id} resolution`,
    );
    this.db.raw
      .prepare<[string, string]>('UPDATE escalations SET resolution_json = ? WHERE id = ?')
      .run(JSON.stringify(resolved.resolution), id);
    return resolved;
  }
}
