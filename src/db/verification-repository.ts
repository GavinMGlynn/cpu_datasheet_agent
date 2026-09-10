import type { ParameterKey } from '../core/parameter-keys.js';
import { parseOrThrow } from '../core/validation-error.js';
import { Verification } from '../core/verification.js';
import { DbError, type Db } from './database.js';

interface VerificationRow {
  parameter_key: string;
  verdict: string;
  quote: string | null;
  page: number;
  checked_at: string;
  prompt_version: string;
  model: string;
}

function hydrate(row: VerificationRow): Verification {
  return parseOrThrow(
    Verification,
    {
      parameterKey: row.parameter_key,
      verdict: row.verdict,
      ...(row.quote === null ? {} : { quote: row.quote }),
      page: row.page,
      checkedAt: row.checked_at,
      promptVersion: row.prompt_version,
      model: row.model,
    },
    `stored Verification ${row.parameter_key}`,
  );
}

export class VerificationRepository {
  constructor(private readonly db: Db) {}

  private partId(mpn: string): number {
    const row = this.db.raw
      .prepare<[string], { id: number }>('SELECT id FROM parts WHERE mpn = ?')
      .get(mpn);
    if (row === undefined) {
      throw new DbError('DB_PART_NOT_FOUND', `no part with mpn ${mpn}`, { details: { mpn } });
    }
    return row.id;
  }

  /** Appends a verdict for a stored part. History is kept; nothing is overwritten. */
  record(mpn: string, input: unknown): Verification {
    const verification = parseOrThrow(Verification, input, 'Verification');
    const partId = this.partId(mpn);
    this.db.raw
      .prepare<[number, string, string, string | null, number, string, string, string]>(
        `INSERT INTO verifications (part_id, parameter_key, verdict, quote, page, checked_at, prompt_version, model)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        partId,
        verification.parameterKey,
        verification.verdict,
        verification.quote ?? null,
        verification.page,
        verification.checkedAt,
        verification.promptVersion,
        verification.model,
      );
    return verification;
  }

  /** All verdicts for a part, oldest first. */
  list(mpn: string): Verification[] {
    const partId = this.partId(mpn);
    return this.db.raw
      .prepare<[number], VerificationRow>(
        `SELECT parameter_key, verdict, quote, page, checked_at, prompt_version, model
         FROM verifications WHERE part_id = ? ORDER BY checked_at, id`,
      )
      .all(partId)
      .map(hydrate);
  }

  /** The most recent verdict per parameter. */
  latestByParameter(mpn: string): Map<ParameterKey, Verification> {
    const latest = new Map<ParameterKey, Verification>();
    for (const verification of this.list(mpn)) {
      latest.set(verification.parameterKey, verification);
    }
    return latest;
  }
}
