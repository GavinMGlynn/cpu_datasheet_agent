import { Datasheet } from '../core/datasheet.js';
import { NormalisedMpn, Sha256 } from '../core/primitives.js';
import { parseOrThrow } from '../core/validation-error.js';
import { DbError, type Db } from './database.js';

interface DatasheetRow {
  sha256: string;
  url: string;
  page_count: number;
  fetched_at: string;
  local_path: string;
}

interface MpnRow {
  mpn: string;
}

const COLUMNS = 'sha256, url, page_count, fetched_at, local_path';

export class DatasheetRepository {
  constructor(private readonly db: Db) {}

  /** Validates and upserts by digest, replacing the covered-MPN list. Returns the stored value. */
  record(input: unknown): Datasheet {
    const datasheet = parseOrThrow(Datasheet, input, 'Datasheet');
    this.db.transaction(() => {
      this.db.raw
        .prepare<[string, string, number, string, string]>(
          `INSERT INTO datasheets (${COLUMNS})
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(sha256) DO UPDATE SET
             url = excluded.url, page_count = excluded.page_count,
             fetched_at = excluded.fetched_at, local_path = excluded.local_path`,
        )
        .run(
          datasheet.sha256,
          datasheet.url,
          datasheet.pageCount,
          datasheet.fetchedAt,
          datasheet.localPath,
        );
      this.db.raw
        .prepare<[string]>('DELETE FROM datasheet_mpns WHERE sha256 = ?')
        .run(datasheet.sha256);
      const link = this.db.raw.prepare<[string, string]>(
        'INSERT INTO datasheet_mpns (sha256, mpn) VALUES (?, ?)',
      );
      for (const mpn of datasheet.coversMpns) {
        link.run(datasheet.sha256, mpn);
      }
    });
    return datasheet;
  }

  private hydrate(row: DatasheetRow): Datasheet {
    return parseOrThrow(
      Datasheet,
      {
        url: row.url,
        sha256: row.sha256,
        pageCount: row.page_count,
        fetchedAt: row.fetched_at,
        localPath: row.local_path,
        coversMpns: this.mpnsCoveredBy(row.sha256),
      },
      `stored Datasheet ${row.sha256}`,
    );
  }

  getBySha(sha256: string): Datasheet | undefined {
    const row = this.db.raw
      .prepare<[string], DatasheetRow>(`SELECT ${COLUMNS} FROM datasheets WHERE sha256 = ?`)
      .get(sha256);
    return row === undefined ? undefined : this.hydrate(row);
  }

  /** Adds one MPN to a datasheet's ordering-table list. Idempotent. */
  linkMpn(sha256: string, mpn: string): void {
    const digest = parseOrThrow(Sha256, sha256, 'sha256');
    const normalised = parseOrThrow(NormalisedMpn, mpn, 'mpn');
    const exists = this.db.raw
      .prepare<[string], { n: number }>('SELECT count(*) AS n FROM datasheets WHERE sha256 = ?')
      .get(digest);
    if (exists === undefined || exists.n === 0) {
      throw new DbError('DB_DATASHEET_NOT_FOUND', `no datasheet with digest ${digest}`, {
        details: { sha256: digest },
      });
    }
    this.db.raw
      .prepare<[string, string]>('INSERT OR IGNORE INTO datasheet_mpns (sha256, mpn) VALUES (?, ?)')
      .run(digest, normalised);
  }

  /** Covered MPNs in the order they were recorded. */
  mpnsCoveredBy(sha256: string): string[] {
    return this.db.raw
      .prepare<[string], MpnRow>('SELECT mpn FROM datasheet_mpns WHERE sha256 = ? ORDER BY rowid')
      .all(sha256)
      .map((row) => row.mpn);
  }

  /**
   * Every datasheet, newest fetch first.
   *
   * Added for the web application (M19), which lists them: one datasheet
   * commonly covers a whole family, so the set of datasheets is a smaller and
   * more useful index than the set of parts.
   */
  list(): Datasheet[] {
    return this.db.raw
      .prepare<[], DatasheetRow>(
        `SELECT ${COLUMNS} FROM datasheets ORDER BY fetched_at DESC, sha256`,
      )
      .all()
      .map((row) => this.hydrate(row));
  }

  /** Datasheets whose ordering table lists the MPN, ordered by digest. */
  findByMpn(mpn: string): Datasheet[] {
    return this.db.raw
      .prepare<[string], DatasheetRow>(
        `SELECT d.sha256, d.url, d.page_count, d.fetched_at, d.local_path
         FROM datasheets d JOIN datasheet_mpns m ON m.sha256 = d.sha256
         WHERE m.mpn = ? ORDER BY d.sha256`,
      )
      .all(mpn)
      .map((row) => this.hydrate(row));
  }
}
