import { z } from 'zod';

import { defineTool } from '../registry.js';
import type { ToolDefinition } from '../types.js';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false } as const;

export const nexarBudgetStatus = defineTool({
  name: 'nexar_budget_status',
  description:
    'Nexar parts used, the hard limit, and what is left of the lifetime evaluation allowance.',
  input: z.strictObject({}),
  output: z.strictObject({
    used: z.int().nonnegative(),
    limit: z.int().nonnegative(),
    remaining: z.int().nonnegative(),
  }),
  annotations: READ_ONLY,
  handler: (_input, context) => {
    const budget = context.repositories.nexarBudget;
    return Promise.resolve({
      used: budget.used(),
      limit: budget.limit(),
      remaining: budget.remaining(),
    });
  },
});

export const cacheStats = defineTool({
  name: 'cache_stats',
  description:
    'Cache counters for this process: hits, misses, expired entries, forced refetches, and calls that joined an in-flight fetch.',
  input: z.strictObject({}),
  output: z.strictObject({
    hits: z.int().nonnegative(),
    misses: z.int().nonnegative(),
    expired: z.int().nonnegative(),
    forced: z.int().nonnegative(),
    joined: z.int().nonnegative(),
  }),
  annotations: READ_ONLY,
  handler: (_input, context) => Promise.resolve({ ...context.cache.stats }),
});

export const OPS_TOOLS: readonly ToolDefinition[] = [nexarBudgetStatus, cacheStats];
