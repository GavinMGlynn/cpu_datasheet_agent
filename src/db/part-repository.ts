import type { ClassificationAxis } from '../core/classification.js';
import { PARAMETER_KEYS, type ParameterKey } from '../core/parameter-keys.js';
import { Part, type Category, type PartStatus } from '../core/part.js';
import { parseOrThrow } from '../core/validation-error.js';
import { requireRow, type Db } from './database.js';
import { DatasheetRepository } from './datasheet-repository.js';
import { numericBounds, parseJson } from './json.js';
import { OfferRepository } from './offer-repository.js';

interface PartRow {
  id: number;
  mpn: string;
  manufacturer: string;
  category: string;
  datasheet_sha256: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface ParameterRow {
  key: string;
  value_json: string;
  provenance_json: string;
  confidence: string;
  conflicts_json: string | null;
}

interface ClassificationRow {
  axis: string;
  value_json: string;
  derived_from_json: string;
  rule: string;
}

interface VerificationRow {
  parameter_key: string;
  verdict: string;
  quote: string | null;
  page: number;
  checked_at: string;
  prompt_version: string;
  model: string;
}

export interface ParameterFilter {
  readonly key: ParameterKey;
  /** The parameter's value (or its whole range) must be at least this. */
  readonly min?: number;
  /** The parameter's value (or its whole range) must be at most this. */
  readonly max?: number;
}

export interface ClassificationFilter {
  readonly axis: ClassificationAxis;
  /** For the `features` axis, one feature that must be present. */
  readonly value: string;
}

export interface PartFilter {
  readonly category?: Category;
  readonly status?: PartStatus;
  readonly classifications?: readonly ClassificationFilter[];
  readonly parameters?: readonly ParameterFilter[];
  readonly limit?: number;
}

const PART_COLUMNS =
  'id, mpn, manufacturer, category, datasheet_sha256, status, created_at, updated_at';

/**
 * Stores and loads the `Part` aggregate. `upsertPart` validates the whole
 * aggregate first and rejects on any issue; it never coerces. Child rows
 * (parameters, classifications, offers, verifications) are replaced so the
 * stored part is exactly the aggregate that was given.
 */
export class PartRepository {
  private readonly datasheets: DatasheetRepository;
  private readonly offers: OfferRepository;

  constructor(private readonly db: Db) {
    this.datasheets = new DatasheetRepository(db);
    this.offers = new OfferRepository(db);
  }

  upsertPart(input: unknown): Part {
    const part = parseOrThrow(Part, input, 'Part');
    this.db.transaction(() => {
      if (part.datasheet !== undefined) {
        this.datasheets.record(part.datasheet);
      }
      this.db.raw
        .prepare<[string, string, string, string | null, string, string, string]>(
          `INSERT INTO parts (mpn, manufacturer, category, datasheet_sha256, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(mpn) DO UPDATE SET
             manufacturer = excluded.manufacturer, category = excluded.category,
             datasheet_sha256 = excluded.datasheet_sha256, status = excluded.status,
             created_at = excluded.created_at, updated_at = excluded.updated_at`,
        )
        .run(
          part.mpn,
          part.manufacturer,
          part.category,
          part.datasheet === undefined ? null : part.datasheet.sha256,
          part.status,
          part.createdAt,
          part.updatedAt,
        );
      const partId = requireRow(this.getPartId(part.mpn), `part ${part.mpn}`);
      this.replaceParameters(partId, part);
      this.replaceClassifications(partId, part);
      this.offers.replaceAllOffers(partId, part.offers);
      this.replaceVerifications(partId, part);
    });
    return requireRow(this.getPart(part.mpn), `part ${part.mpn}`);
  }

  private replaceParameters(partId: number, part: Part): void {
    this.db.raw.prepare<[number]>('DELETE FROM parameters WHERE part_id = ?').run(partId);
    const insert = this.db.raw.prepare<
      [
        number,
        string,
        string,
        number | null,
        number | null,
        string | null,
        string,
        string,
        string | null,
      ]
    >(
      `INSERT INTO parameters (part_id, key, value_json, numeric_min, numeric_max, unit, provenance_json, confidence, conflicts_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const key of PARAMETER_KEYS) {
      const parameter = part.parameters[key];
      const bounds = numericBounds(parameter.value);
      insert.run(
        partId,
        key,
        JSON.stringify(parameter.value),
        bounds?.min ?? null,
        bounds?.max ?? null,
        bounds?.unit ?? null,
        JSON.stringify(parameter.provenance),
        parameter.confidence,
        parameter.conflicts === undefined ? null : JSON.stringify(parameter.conflicts),
      );
    }
  }

  private replaceClassifications(partId: number, part: Part): void {
    this.db.raw.prepare<[number]>('DELETE FROM classifications WHERE part_id = ?').run(partId);
    const insert = this.db.raw.prepare<[number, string, string, string, string]>(
      'INSERT INTO classifications (part_id, axis, value_json, derived_from_json, rule) VALUES (?, ?, ?, ?, ?)',
    );
    for (const classification of part.classifications) {
      insert.run(
        partId,
        classification.axis,
        JSON.stringify(classification.value),
        JSON.stringify(classification.derivedFrom),
        classification.rule,
      );
    }
  }

  private replaceVerifications(partId: number, part: Part): void {
    this.db.raw.prepare<[number]>('DELETE FROM verifications WHERE part_id = ?').run(partId);
    const insert = this.db.raw.prepare<
      [number, string, string, string | null, number, string, string, string]
    >(
      `INSERT INTO verifications (part_id, parameter_key, verdict, quote, page, checked_at, prompt_version, model)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const verification of part.verifications) {
      insert.run(
        partId,
        verification.parameterKey,
        verification.verdict,
        verification.quote ?? null,
        verification.page,
        verification.checkedAt,
        verification.promptVersion,
        verification.model,
      );
    }
  }

  getPartId(mpn: string): number | undefined {
    return this.db.raw
      .prepare<[string], { id: number }>('SELECT id FROM parts WHERE mpn = ?')
      .get(mpn)?.id;
  }

  getPart(mpn: string): Part | undefined {
    const row = this.db.raw
      .prepare<[string], PartRow>(`SELECT ${PART_COLUMNS} FROM parts WHERE mpn = ?`)
      .get(mpn);
    return row === undefined ? undefined : this.hydrate(row);
  }

  private hydrate(row: PartRow): Part {
    const parameters: Record<string, unknown> = {};
    for (const parameter of this.db.raw
      .prepare<[number], ParameterRow>(
        'SELECT key, value_json, provenance_json, confidence, conflicts_json FROM parameters WHERE part_id = ?',
      )
      .all(row.id)) {
      parameters[parameter.key] = {
        value: parseJson(parameter.value_json),
        provenance: parseJson(parameter.provenance_json),
        confidence: parameter.confidence,
        // Absent rather than null: the schema's optional annotation means
        // "nothing disagreed", and a null would be an unknown key.
        ...(parameter.conflicts_json === null
          ? {}
          : { conflicts: parseJson(parameter.conflicts_json) }),
      };
    }
    const classifications = this.db.raw
      .prepare<[number], ClassificationRow>(
        'SELECT axis, value_json, derived_from_json, rule FROM classifications WHERE part_id = ? ORDER BY axis',
      )
      .all(row.id)
      .map((classification) => ({
        axis: classification.axis,
        value: parseJson(classification.value_json),
        derivedFrom: parseJson(classification.derived_from_json),
        rule: classification.rule,
      }));
    const verifications = this.db.raw
      .prepare<[number], VerificationRow>(
        `SELECT parameter_key, verdict, quote, page, checked_at, prompt_version, model
         FROM verifications WHERE part_id = ? ORDER BY checked_at, id`,
      )
      .all(row.id)
      .map((verification) => ({
        parameterKey: verification.parameter_key,
        verdict: verification.verdict,
        ...(verification.quote === null ? {} : { quote: verification.quote }),
        page: verification.page,
        checkedAt: verification.checked_at,
        promptVersion: verification.prompt_version,
        model: verification.model,
      }));
    const datasheet =
      row.datasheet_sha256 === null ? undefined : this.datasheets.getBySha(row.datasheet_sha256);
    return parseOrThrow(
      Part,
      {
        mpn: row.mpn,
        manufacturer: row.manufacturer,
        category: row.category,
        parameters,
        ...(datasheet === undefined ? {} : { datasheet }),
        offers: this.offers.getOffers(row.id),
        classifications,
        verifications,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
      `stored Part ${row.mpn}`,
    );
  }

  /** Parts matching every clause of the filter, ordered by MPN. */
  findParts(filter: PartFilter = {}): Part[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (filter.category !== undefined) {
      clauses.push('p.category = ?');
      params.push(filter.category);
    }
    if (filter.status !== undefined) {
      clauses.push('p.status = ?');
      params.push(filter.status);
    }
    for (const classification of filter.classifications ?? []) {
      if (classification.axis === 'features') {
        clauses.push(
          `EXISTS (SELECT 1 FROM classifications c, json_each(c.value_json) f
                   WHERE c.part_id = p.id AND c.axis = 'features' AND f.value = ?)`,
        );
        params.push(classification.value);
      } else {
        clauses.push(
          'EXISTS (SELECT 1 FROM classifications c WHERE c.part_id = p.id AND c.axis = ? AND c.value_json = ?)',
        );
        params.push(classification.axis, JSON.stringify(classification.value));
      }
    }
    for (const parameter of filter.parameters ?? []) {
      const conditions = ['q.part_id = p.id', 'q.key = ?'];
      params.push(parameter.key);
      if (parameter.min !== undefined) {
        conditions.push('q.numeric_min >= ?');
        params.push(parameter.min);
      }
      if (parameter.max !== undefined) {
        conditions.push('q.numeric_max <= ?');
        params.push(parameter.max);
      }
      clauses.push(`EXISTS (SELECT 1 FROM parameters q WHERE ${conditions.join(' AND ')})`);
    }
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`;
    const limit =
      filter.limit === undefined ? '' : ` LIMIT ${String(Math.max(0, Math.trunc(filter.limit)))}`;
    return this.db.raw
      .prepare<(string | number)[], PartRow>(
        `SELECT ${PART_COLUMNS} FROM parts p${where} ORDER BY p.mpn${limit}`,
      )
      .all(...params)
      .map((row) => this.hydrate(row));
  }

  listByStatus(status: PartStatus): Part[] {
    return this.findParts({ status });
  }
}
