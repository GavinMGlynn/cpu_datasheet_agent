import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  finishedRun,
  part as partFixture,
  run as runFixture,
  toolCallRecord,
  type Loose,
} from '../../../test/helpers/core-fixtures.js';
import { createTestApi, type TestApi } from '../../../test/helpers/web-api.js';
import type { RunResult } from '../../core/run.js';
import { registerStats } from './stats.js';

let api: TestApi;

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function storeRun(overrides: Loose): void {
  api.repositories.runs.start(
    runFixture({
      ...overrides,
      endedAt: undefined,
      turns: undefined,
      costUsd: undefined,
      result: undefined,
      details: undefined,
    }),
  );
  const finished = finishedRun(overrides) as {
    id: string;
    endedAt: string;
    turns: number;
    costUsd: number;
    result: RunResult;
    details: unknown;
    sessionId?: string;
  };
  api.repositories.runs.finish(finished.id, {
    endedAt: finished.endedAt,
    turns: finished.turns,
    costUsd: finished.costUsd,
    result: finished.result,
    details: finished.details,
    ...(finished.sessionId === undefined ? {} : { sessionId: finished.sessionId }),
  });
}

beforeEach(async () => {
  api = await createTestApi({ register: registerStats });
  api.repositories.parts.upsertPart(partFixture());
  storeRun({
    id: uuid(1),
    mpn: 'TPS54331DR',
    kind: 'extract',
    costUsd: 3.41,
    turns: 18,
    startedAt: '2026-09-11T09:00:00Z',
    endedAt: '2026-09-11T09:04:00Z',
  });
  storeRun({
    id: uuid(2),
    mpn: 'TPS54331DR',
    kind: 'verify',
    promptVersion: 'verify.v1',
    costUsd: 0.45,
    turns: 6,
    startedAt: '2026-09-12T02:00:00Z',
    endedAt: '2026-09-12T02:01:00Z',
    result: 'verified',
  });
  await api.appendLedger([
    toolCallRecord({ id: uuid(10), tool: 'read_pages', durationMs: 120 }),
    toolCallRecord({
      id: uuid(11),
      tool: 'fetch_offers',
      spendsQuota: true,
      durationMs: 2100,
      startedAt: '2026-09-11T09:01:00Z',
    }),
    toolCallRecord({
      id: uuid(12),
      tool: 'digikey_keyword_search',
      spendsQuota: true,
      output: undefined,
      error: {
        name: 'CacheMissError',
        code: 'CACHE_MISS',
        message: 'no cached entry',
        details: { namespace: 'digikey_keyword_search' },
      },
      startedAt: '2026-09-11T09:02:00Z',
    }),
    toolCallRecord({
      id: uuid(13),
      tool: 'spend_gate',
      output: { decision: 'deny' },
      startedAt: '2026-09-11T09:03:00Z',
    }),
  ]);
});

afterEach(async () => {
  await api.close();
});

describe('GET /api/stats/overview', () => {
  it('answers what it cost, what it did, and what a value is worth', async () => {
    const result = await api.get('/api/stats/overview');
    expect(result.status).toBe(200);
    const body = result.body as {
      runs: { runs: number; costUsd: number };
      value: { parts: number; perStatedParameter: number };
      ledger: { records: number };
      cache: { misses: number };
      gate: { total: number };
      estimates: { extract: { basis: number } };
    };
    expect(body.runs.runs).toBe(2);
    expect(body.runs.costUsd).toBeCloseTo(3.86, 10);
    expect(body.value.parts).toBe(1);
    expect(body.value.perStatedParameter).toBeGreaterThan(0);
    expect(body.ledger.records).toBe(4);
    expect(body.cache.misses).toBe(1);
    expect(body.gate.total).toBe(1);
    expect(body.estimates.extract.basis).toBe(1);
  });

  it('narrows the ledger side to a window', async () => {
    const result = await api.get('/api/stats/overview?from=2026-09-11T09:02:00Z');
    expect(
      (result.body as { ledger: { records: number }; gate: { total: number } }).gate.total,
    ).toBe(1);
  });
});

describe('spend', () => {
  it('plots spend over time at the granularity asked for', async () => {
    const daily = await api.get('/api/stats/spend');
    expect(daily.body).toMatchObject({ granularity: 'day' });
    expect((daily.body as { points: unknown[] }).points).toHaveLength(2);
    const monthly = await api.get('/api/stats/spend?granularity=month');
    expect((monthly.body as { points: unknown[] }).points).toHaveLength(1);
  });

  it('breaks spend down by every dimension it offers', async () => {
    for (const dimension of ['model', 'kind', 'promptVersion', 'mpn', 'result']) {
      const result = await api.get(`/api/stats/spend/${dimension}`);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ dimension });
    }
  });

  it('refuses a dimension it does not have', async () => {
    expect((await api.get('/api/stats/spend/phase-of-moon')).status).toBe(400);
    expect((await api.get('/api/stats/spend?granularity=fortnight')).status).toBe(400);
  });
});

describe('the ledger-side statistics', () => {
  it('reports per-tool behaviour and failure codes', async () => {
    const tools = (await api.get('/api/stats/tools')).body as {
      tools: { tool: string; calls: number }[];
    };
    expect(tools.tools.map((tool) => tool.tool)).toContain('read_pages');
    const errors = (await api.get('/api/stats/errors')).body as { errors: { code: string }[] };
    expect(errors.errors[0]?.code).toBe('CACHE_MISS');
  });

  it('reports what the cache could not answer and what the gate refused', async () => {
    const cache = (await api.get('/api/stats/cache')).body as {
      misses: number;
      byNamespace: Record<string, number>;
    };
    expect(cache.misses).toBe(1);
    expect(cache.byNamespace.digikey_keyword_search).toBe(1);
    const gate = (await api.get('/api/stats/gate')).body as { decisions: Record<string, number> };
    expect(gate.decisions.deny).toBe(1);
  });
});

describe('value and estimates', () => {
  it('divides spend by what was stored', async () => {
    const value = (await api.get('/api/stats/value')).body as { perPart: number };
    expect(value.perPart).toBeCloseTo(3.86, 10);
  });

  it('projects a sweep over as many parts as asked', async () => {
    const estimate = (await api.get('/api/stats/estimate?kind=extract&parts=22')).body as {
      parts: number;
      estimateUsd: number;
    };
    expect(estimate.parts).toBe(22);
    expect(estimate.estimateUsd).toBeCloseTo(75.02, 10);
  });

  it('defaults to the parts it holds', async () => {
    const estimate = (await api.get('/api/stats/estimate')).body as { parts: number };
    expect(estimate.parts).toBe(1);
  });

  it('takes a window on the ledger side with both ends given', async () => {
    const result = await api.get(
      '/api/stats/tools?from=2026-09-11T09:00:30Z&to=2026-09-11T09:02:30Z',
    );
    const tools = (result.body as { tools: { tool: string }[] }).tools.map((tool) => tool.tool);
    expect(tools).toStrictEqual(['fetch_offers', 'digikey_keyword_search']);
  });

  it('refuses a run kind it does not have', async () => {
    expect((await api.get('/api/stats/estimate?kind=guessing')).status).toBe(400);
  });
});

describe('payload shapes', () => {
  it('keeps the shape of the overview and of a spend breakdown', async () => {
    const overview = (await api.get('/api/stats/overview')).body as Record<string, unknown>;
    expect(Object.keys(overview).sort()).toMatchSnapshot();
    expect((await api.get('/api/stats/spend/kind')).body).toMatchSnapshot();
  });
});
