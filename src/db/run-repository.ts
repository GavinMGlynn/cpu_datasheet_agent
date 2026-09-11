import { parseOrThrow } from '../core/validation-error.js';
import { Run, RunDetails, type FinishedRun, type RunKind, type RunResult } from '../core/run.js';
import { DbError, type Db } from './database.js';
import { parseJson } from './json.js';

interface RunRow {
  id: string;
  mpn: string;
  kind: string;
  prompt_version: string;
  model: string;
  session_id: string | null;
  started_at: string;
  ended_at: string | null;
  turns: number | null;
  cost_usd: number | null;
  result: string | null;
  details_json: string | null;
}

/** Optional fields accept an explicit `undefined`; see `EscalationFilter`. */
export interface RunFilter {
  readonly mpn?: string | undefined;
  readonly kind?: RunKind | undefined;
  readonly promptVersion?: string | undefined;
  readonly result?: RunResult | undefined;
  /** true: only runs that ended; false: only runs still open; omitted: both. */
  readonly finished?: boolean | undefined;
  readonly limit?: number | undefined;
}

/** What a run knows when it ends. */
export interface RunOutcome {
  readonly endedAt: string;
  readonly turns: number;
  readonly costUsd: number;
  readonly result: RunResult;
  readonly details: unknown;
  /** The harness session, when the run learned one. */
  readonly sessionId?: string | undefined;
}

function hydrate(row: RunRow): Run {
  return parseOrThrow(
    Run,
    {
      id: row.id,
      mpn: row.mpn,
      kind: row.kind,
      promptVersion: row.prompt_version,
      model: row.model,
      ...(row.session_id === null ? {} : { sessionId: row.session_id }),
      startedAt: row.started_at,
      ...(row.ended_at === null ? {} : { endedAt: row.ended_at }),
      ...(row.turns === null ? {} : { turns: row.turns }),
      ...(row.cost_usd === null ? {} : { costUsd: row.cost_usd }),
      ...(row.result === null ? {} : { result: row.result }),
      ...(row.details_json === null ? {} : { details: parseJson(row.details_json) }),
    },
    `stored Run ${row.id}`,
  );
}

const COLUMNS =
  'id, mpn, kind, prompt_version, model, session_id, started_at, ended_at, turns, cost_usd, result, details_json';

/**
 * The record of every agent run.
 *
 * A run is written when it starts and completed when it ends, so a process
 * that died mid-run leaves a row with no result rather than nothing at all.
 * `finish` re-parses the whole row, which is what stops a half-finished
 * ending — a result with no cost, say — from reaching the table.
 */
export class RunRepository {
  constructor(private readonly db: Db) {}

  /** Records a run that has begun. A run that already has a result is not one. */
  start(input: unknown): Run {
    const run = parseOrThrow(Run, input, 'Run');
    if (run.result !== undefined) {
      throw new DbError('DB_RUN_ALREADY_FINISHED', `run ${run.id} is already finished`, {
        details: { id: run.id, result: run.result },
      });
    }
    try {
      this.db.raw
        .prepare<[string, string, string, string, string, string | null, string]>(
          `INSERT INTO runs (id, mpn, kind, prompt_version, model, session_id, started_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          run.id,
          run.mpn,
          run.kind,
          run.promptVersion,
          run.model,
          run.sessionId ?? null,
          run.startedAt,
        );
    } catch (error) {
      throw new DbError('DB_DUPLICATE_RUN', `run ${run.id} already exists`, {
        cause: error,
        details: { id: run.id },
      });
    }
    return run;
  }

  /** Completes a run. A run can be finished once. */
  finish(id: string, outcome: RunOutcome): FinishedRun {
    const existing = this.get(id);
    if (existing === undefined) {
      throw new DbError('DB_RUN_NOT_FOUND', `no run with id ${id}`, { details: { id } });
    }
    if (existing.result !== undefined) {
      throw new DbError('DB_RUN_ALREADY_FINISHED', `run ${id} is already finished`, {
        details: { id, result: existing.result },
      });
    }
    const sessionId = outcome.sessionId ?? existing.sessionId;
    // Parsed on its own first so the column has a value the column's type
    // agrees with, rather than one the whole-row parse has proved and the
    // compiler still calls optional.
    const details = parseOrThrow(RunDetails, outcome.details, `RunDetails for run ${id}`);
    const finished = parseOrThrow(
      Run,
      {
        ...existing,
        ...(sessionId === undefined ? {} : { sessionId }),
        endedAt: outcome.endedAt,
        turns: outcome.turns,
        costUsd: outcome.costUsd,
        result: outcome.result,
        details,
      },
      `Run ${id}`,
    );
    this.db.raw
      .prepare<[string | null, string, number, number, string, string, string]>(
        `UPDATE runs SET session_id = ?, ended_at = ?, turns = ?, cost_usd = ?, result = ?, details_json = ?
         WHERE id = ?`,
      )
      .run(
        finished.sessionId ?? null,
        outcome.endedAt,
        outcome.turns,
        outcome.costUsd,
        outcome.result,
        JSON.stringify(details),
        id,
      );
    // Built from the ending rather than read back out of the parsed record:
    // these five fields are present because they were just supplied, and
    // saying so in the type costs nothing here and saves a fallback for an
    // impossible state at every reader.
    return {
      ...finished,
      endedAt: outcome.endedAt,
      turns: outcome.turns,
      costUsd: outcome.costUsd,
      result: outcome.result,
      details,
    };
  }

  get(id: string): Run | undefined {
    const row = this.db.raw
      .prepare<[string], RunRow>(`SELECT ${COLUMNS} FROM runs WHERE id = ?`)
      .get(id);
    return row === undefined ? undefined : hydrate(row);
  }

  /** Runs matching the filter, newest first. */
  list(filter: RunFilter = {}): Run[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (filter.mpn !== undefined) {
      clauses.push('mpn = ?');
      params.push(filter.mpn);
    }
    if (filter.kind !== undefined) {
      clauses.push('kind = ?');
      params.push(filter.kind);
    }
    if (filter.promptVersion !== undefined) {
      clauses.push('prompt_version = ?');
      params.push(filter.promptVersion);
    }
    if (filter.result !== undefined) {
      clauses.push('result = ?');
      params.push(filter.result);
    }
    if (filter.finished !== undefined) {
      clauses.push(filter.finished ? 'result IS NOT NULL' : 'result IS NULL');
    }
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`;
    return this.db.raw
      .prepare<(string | number)[], RunRow>(
        `SELECT ${COLUMNS} FROM runs${where} ORDER BY started_at DESC, id DESC LIMIT ?`,
      )
      .all(...params, filter.limit ?? 50)
      .map(hydrate);
  }

  /**
   * The most recent finished run for this part under this prompt version, or
   * undefined when there is none.
   *
   * This is what a resumable batch asks: a part that has been run to a
   * conclusion is not run again unless the caller insists.
   */
  latestFinished(mpn: string, kind: RunKind, promptVersion: string): Run | undefined {
    return this.list({ mpn, kind, promptVersion, finished: true, limit: 1 })[0];
  }
}
