import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DbError, type Db } from './database.js';
import { BudgetExhaustedError, NexarBudgetRepository } from './nexar-budget-repository.js';
import { openDatabase } from './open.js';

let dir: string;
let db: Db;
let budget: NexarBudgetRepository;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'budget-'));
  db = openDatabase(':memory:');
  budget = new NexarBudgetRepository(db);
});

afterEach(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true });
});

describe('NexarBudgetRepository', () => {
  it('starts at zero used with the default limit', () => {
    expect(budget.used()).toBe(0);
    expect(budget.limit()).toBe(90);
    expect(budget.remaining()).toBe(90);
  });

  it('reserves parts and reports the running total', () => {
    expect(budget.reserve(5)).toBe(5);
    expect(budget.reserve(1)).toBe(6);
    expect(budget.used()).toBe(6);
    expect(budget.remaining()).toBe(84);
  });

  it('refuses a reservation that would exceed the limit without changing anything', () => {
    budget.setLimit(10);
    budget.reserve(9);
    expect(() => budget.reserve(2)).toThrow(BudgetExhaustedError);
    try {
      budget.reserve(2);
    } catch (error) {
      expect((error as BudgetExhaustedError).code).toBe('NEXAR_BUDGET_EXHAUSTED');
      expect((error as BudgetExhaustedError).details).toEqual({ used: 9, limit: 10, requested: 2 });
    }
    expect(budget.used()).toBe(9);
    expect(budget.reserve(1)).toBe(10);
    expect(budget.remaining()).toBe(0);
  });

  it('reports zero remaining when the limit is lowered below usage', () => {
    budget.reserve(5);
    budget.setLimit(3);
    expect(budget.remaining()).toBe(0);
    expect(() => budget.reserve(1)).toThrow(BudgetExhaustedError);
  });

  it('validates limits and counts', () => {
    expect(() => {
      budget.setLimit(-1);
    }).toThrow(DbError);
    expect(() => {
      budget.setLimit(1.5);
    }).toThrow(DbError);
    expect(() => budget.reserve(0)).toThrow(DbError);
    expect(() => budget.reserve(2.5)).toThrow(DbError);
    budget.setLimit(0);
    expect(budget.limit()).toBe(0);
  });

  it('serialises reservations from two connections to the same file', () => {
    const file = path.join(dir, 'budget.sqlite');
    const a = openDatabase(file, { busyTimeoutMs: 2000 });
    const b = openDatabase(file, { busyTimeoutMs: 2000 });
    const budgetA = new NexarBudgetRepository(a);
    const budgetB = new NexarBudgetRepository(b);
    budgetA.setLimit(3);

    expect(budgetA.reserve(2)).toBe(2);
    expect(budgetB.used()).toBe(2);
    expect(budgetB.reserve(1)).toBe(3);
    expect(() => budgetA.reserve(1)).toThrow(BudgetExhaustedError);
    expect(budgetA.used()).toBe(3);

    a.close();
    b.close();
  });
});
