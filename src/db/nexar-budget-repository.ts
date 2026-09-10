import { ChipAgentError } from '../errors.js';
import { DbError, requireRow, type Db } from './database.js';

export class BudgetExhaustedError extends ChipAgentError {}

interface BudgetRow {
  used: number;
  limit_value: number;
}

/**
 * Lifetime counter of parts requested from Nexar. `reserve` runs in an
 * immediate transaction so two connections cannot both slip under the limit.
 */
export class NexarBudgetRepository {
  constructor(private readonly db: Db) {}

  private row(): BudgetRow {
    return requireRow(
      this.db.raw
        .prepare<[], BudgetRow>('SELECT used, limit_value FROM nexar_budget WHERE id = 1')
        .get(),
      'nexar budget row',
    );
  }

  used(): number {
    return this.row().used;
  }

  limit(): number {
    return this.row().limit_value;
  }

  remaining(): number {
    const row = this.row();
    return Math.max(0, row.limit_value - row.used);
  }

  setLimit(limit: number): void {
    if (!Number.isInteger(limit) || limit < 0) {
      throw new DbError(
        'DB_BUDGET_INVALID_LIMIT',
        `budget limit must be a non-negative integer, received ${String(limit)}`,
        {
          details: { limit },
        },
      );
    }
    this.db.raw
      .prepare<[number]>('UPDATE nexar_budget SET limit_value = ? WHERE id = 1')
      .run(limit);
  }

  /** Reserves `count` parts, returning the new total used, or throws without changing anything. */
  reserve(count: number): number {
    if (!Number.isInteger(count) || count < 1) {
      throw new DbError(
        'DB_BUDGET_INVALID_COUNT',
        `reservation must be a positive integer, received ${String(count)}`,
        {
          details: { count },
        },
      );
    }
    return this.db.immediateTransaction(() => {
      const row = this.row();
      if (row.used + count > row.limit_value) {
        throw new BudgetExhaustedError(
          'NEXAR_BUDGET_EXHAUSTED',
          `reserving ${String(count)} would exceed the Nexar budget (${String(row.used)} of ${String(row.limit_value)} used)`,
          { details: { used: row.used, limit: row.limit_value, requested: count } },
        );
      }
      const next = row.used + count;
      this.db.raw.prepare<[number]>('UPDATE nexar_budget SET used = ? WHERE id = 1').run(next);
      return next;
    });
  }
}
