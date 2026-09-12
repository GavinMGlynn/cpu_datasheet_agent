import { describe, expect, it } from 'vitest';

import {
  buckParameters,
  finishedRun,
  part as partFixture,
  toolCallRecord,
  withConfidence,
  type Loose,
} from '../../../test/helpers/core-fixtures.js';
import { Part } from '../../core/part.js';
import { Run } from '../../core/run.js';
import { ToolCallRecord } from '../../core/tool-call-record.js';
import { parseOrThrow } from '../../core/validation-error.js';
import {
  cacheStats,
  errorStats,
  estimateSweep,
  gateStats,
  runTotals,
  sessionTree,
  spendBy,
  spendOverTime,
  toolStats,
  valueCost,
} from './stats.js';

function run(overrides: Loose = {}): Run {
  return parseOrThrow(Run, finishedRun(overrides), 'Run');
}

function call(overrides: Loose = {}): ToolCallRecord {
  return parseOrThrow(ToolCallRecord, toolCallRecord(overrides), 'ToolCallRecord');
}

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

const runs: Run[] = [
  run({
    id: uuid(1),
    mpn: 'TPS54331DR',
    kind: 'extract',
    costUsd: 3.41,
    turns: 18,
    startedAt: '2026-09-11T09:00:00Z',
    endedAt: '2026-09-11T09:04:00Z',
    result: 'extracted',
  }),
  run({
    id: uuid(2),
    mpn: 'AP62200WU-7',
    kind: 'extract',
    model: 'claude-haiku-4-5',
    costUsd: 4.27,
    turns: 20,
    startedAt: '2026-09-11T11:00:00Z',
    endedAt: '2026-09-11T11:06:00Z',
    result: 'needs_human',
  }),
  run({
    id: uuid(3),
    mpn: 'TPS54331DR',
    kind: 'verify',
    promptVersion: 'verify.v1',
    costUsd: 0.45,
    turns: 6,
    startedAt: '2026-09-12T02:00:00Z',
    endedAt: '2026-09-12T02:01:00Z',
    result: 'verified',
  }),
];

describe('spendOverTime', () => {
  it('adds up by day and carries a running total', () => {
    const points = spendOverTime(runs);
    expect(points.map((point) => point.key)).toStrictEqual(['2026-09-11', '2026-09-12']);
    expect(points[0]).toMatchObject({ runs: 2, turns: 38 });
    expect(points[0]?.costUsd).toBeCloseTo(7.68, 10);
    expect(points[1]?.cumulativeUsd).toBeCloseTo(8.13, 10);
  });

  it('buckets by any granularity', () => {
    expect(spendOverTime(runs, 'month').map((point) => point.key)).toStrictEqual(['2026-09']);
    expect(spendOverTime(runs, 'hour')).toHaveLength(3);
  });

  it('counts an unfinished run without inventing a cost for it', () => {
    const open = parseOrThrow(
      Run,
      { id: uuid(4), mpn: 'LM5164DDAR', kind: 'extract', promptVersion: 'extract.v1', model: 'claude-opus-5', startedAt: '2026-09-13T00:00:00Z' },
      'Run',
    );
    const points = spendOverTime([open]);
    expect(points[0]).toMatchObject({ runs: 1, costUsd: 0, turns: 0 });
  });

  it('has nothing to plot for no runs', () => {
    expect(spendOverTime([])).toStrictEqual([]);
  });
});

describe('spendBy', () => {
  it('breaks spend down by every dimension, dearest first', () => {
    const byKind = spendBy(runs, 'kind');
    expect(byKind[0]).toMatchObject({ key: 'extract', runs: 2, turns: 38, unsuccessful: 1 });
    expect(byKind[0]?.costUsd).toBeCloseTo(7.68, 10);
    expect(byKind[0]?.meanCostUsd).toBeCloseTo(3.84, 10);
    expect(byKind[1]).toMatchObject({ key: 'verify', runs: 1, costUsd: 0.45, unsuccessful: 0 });
    expect(spendBy(runs, 'model').map((row) => row.key)).toStrictEqual([
      'claude-haiku-4-5',
      'claude-opus-5',
    ]);
    expect(spendBy(runs, 'promptVersion').map((row) => row.key)).toStrictEqual([
      'extract.v1',
      'verify.v1',
    ]);
    expect(spendBy(runs, 'mpn').map((row) => row.key)).toStrictEqual([
      'AP62200WU-7',
      'TPS54331DR',
    ]);
    expect(spendBy(runs, 'result').map((row) => row.key)).toStrictEqual([
      'needs_human',
      'extracted',
      'verified',
    ]);
  });

  it('calls an unfinished run unsuccessful and names it so', () => {
    const open = parseOrThrow(
      Run,
      { id: uuid(5), mpn: 'LM5164DDAR', kind: 'extract', promptVersion: 'extract.v1', model: 'claude-opus-5', startedAt: '2026-09-13T00:00:00Z' },
      'Run',
    );
    expect(spendBy([open], 'result')).toStrictEqual([
      { key: 'unfinished', runs: 1, costUsd: 0, turns: 0, meanCostUsd: 0, unsuccessful: 1 },
    ]);
  });
});

describe('runTotals', () => {
  it('counts runs, cost, turns, duration and what the details recorded', () => {
    const totals = runTotals(runs);
    expect(totals).toMatchObject({
      runs: 3,
      finished: 3,
      turns: 44,
      byResult: { extracted: 1, needs_human: 1, verified: 1 },
      toolCalls: 27,
      toolFailures: 0,
      escalations: 0,
      spendDenials: 0,
      cacheMisses: 0,
    });
    expect(totals.costUsd).toBeCloseTo(8.13, 10);
    expect(totals.duration?.max).toBe(360_000);
    expect(totals.cost?.count).toBe(3);
    expect(totals.turnsPerRun?.max).toBe(20);
  });

  it('counts an unfinished run without inventing its cost, turns or details', () => {
    const open = parseOrThrow(
      Run,
      {
        id: uuid(6),
        mpn: 'LM5164DDAR',
        kind: 'extract',
        promptVersion: 'extract.v1',
        model: 'claude-opus-5',
        startedAt: '2026-09-13T00:00:00Z',
      },
      'Run',
    );
    const totals = runTotals([open]);
    expect(totals).toMatchObject({
      runs: 1,
      finished: 0,
      costUsd: 0,
      turns: 0,
      toolCalls: 0,
      toolFailures: 0,
      escalations: 0,
      spendDenials: 0,
      cacheMisses: 0,
      byResult: { unfinished: 1 },
    });
    expect(totals.duration).toBeUndefined();
  });

  it('has no distribution to report for no runs', () => {
    expect(runTotals([])).toMatchObject({ runs: 0, costUsd: 0, cost: undefined, duration: undefined });
  });
});

describe('toolStats and errorStats', () => {
  const records = [
    call({ id: uuid(10), tool: 'read_pages', durationMs: 100 }),
    call({ id: uuid(11), tool: 'read_pages', durationMs: 300 }),
    call({
      id: uuid(12),
      tool: 'read_pages',
      durationMs: 5,
      output: undefined,
      error: { name: 'PdfError', code: 'PDF_PAGE_MISSING', message: 'no page 99', details: {} },
      startedAt: '2026-09-11T12:00:00Z',
    }),
    call({ id: uuid(13), tool: 'fetch_offers', spendsQuota: true, durationMs: 2000 }),
  ];

  it('reports calls, failures, spending and timing per tool', () => {
    const [pages, offers] = toolStats(records);
    expect(pages).toMatchObject({
      tool: 'read_pages',
      calls: 3,
      failures: 1,
      spending: 0,
      totalMs: 405,
      errors: { PDF_PAGE_MISSING: 1 },
    });
    expect(pages?.failureRate).toBeCloseTo(1 / 3, 10);
    expect(pages?.duration.p50).toBe(100);
    expect(offers).toMatchObject({ tool: 'fetch_offers', spending: 1, failures: 0, errors: {} });
  });

  it('groups failures by code, most frequent first, keeping the latest message', () => {
    const stats = errorStats([
      ...records,
      call({
        id: uuid(14),
        tool: 'fetch_pdf',
        output: undefined,
        error: { name: 'PdfError', code: 'PDF_PAGE_MISSING', message: 'still missing', details: {} },
        startedAt: '2026-09-11T13:00:00Z',
      }),
      call({
        id: uuid(16),
        tool: 'read_pages',
        output: undefined,
        error: { name: 'PdfError', code: 'PDF_PAGE_MISSING', message: 'earlier', details: {} },
        startedAt: '2026-09-11T07:00:00Z',
      }),
      call({
        id: uuid(15),
        tool: 'fetch_offers',
        output: undefined,
        error: { name: 'CacheMissError', code: 'CACHE_MISS', message: 'not cached', details: {} },
        startedAt: '2026-09-11T08:00:00Z',
      }),
    ]);
    expect(stats[0]).toMatchObject({
      code: 'PDF_PAGE_MISSING',
      count: 3,
      tools: ['fetch_pdf', 'read_pages'],
      message: 'still missing',
      latestAt: '2026-09-11T13:00:00Z',
    });
    expect(stats[1]?.code).toBe('CACHE_MISS');
  });

  it('has nothing to say about no calls', () => {
    expect(toolStats([])).toStrictEqual([]);
    expect(errorStats([])).toStrictEqual([]);
  });
});

describe('cacheStats', () => {
  it('counts refused calls by namespace', () => {
    const stats = cacheStats([
      call({ id: uuid(20), tool: 'fetch_offers', spendsQuota: true }),
      call({
        id: uuid(21),
        tool: 'digikey_keyword_search',
        spendsQuota: true,
        output: undefined,
        error: {
          name: 'CacheMissError',
          code: 'CACHE_MISS',
          message: 'no cached entry',
          details: { namespace: 'digikey_keyword_search' },
        },
      }),
      call({
        id: uuid(22),
        tool: 'fetch_pdf',
        output: undefined,
        error: { name: 'CacheMissError', code: 'CACHE_MISS', message: 'no cached entry', details: {} },
      }),
    ]);
    expect(stats).toMatchObject({
      misses: 2,
      callsThatCouldMiss: 3,
      byNamespace: { digikey_keyword_search: 1, fetch_pdf: 1 },
    });
    expect(stats.missRate).toBeCloseTo(2 / 3, 10);
  });

  it('divides by nothing safely', () => {
    expect(cacheStats([])).toStrictEqual({
      misses: 0,
      callsThatCouldMiss: 0,
      missRate: 0,
      byNamespace: {},
    });
  });
});

describe('gateStats', () => {
  it('counts what the money gate decided', () => {
    const stats = gateStats([
      call({ id: uuid(30), tool: 'spend_gate', output: { decision: 'allow' } }),
      call({ id: uuid(31), tool: 'spend_gate', output: { decision: 'deny' } }),
      call({ id: uuid(32), tool: 'spend_gate', output: { decision: 'ask' } }),
      call({ id: uuid(33), tool: 'spend_gate', output: 'nonsense' }),
      call({ id: uuid(34), tool: 'spend_gate', output: { decision: 7 } }),
      call({ id: uuid(35), tool: 'read_pages' }),
    ]);
    expect(stats.total).toBe(5);
    expect(stats.decisions).toStrictEqual({ allow: 1, deny: 1, ask: 1, unknown: 2 });
    expect(stats.denialRate).toBeCloseTo(0.4, 10);
  });

  it('has no decisions to report when the gate never ran', () => {
    expect(gateStats([])).toStrictEqual({ decisions: {}, total: 0, denialRate: 0 });
  });
});

describe('valueCost', () => {
  it('divides what was spent by what was stored', () => {
    const parts = [
      parseOrThrow(Part, partFixture(), 'Part'),
      parseOrThrow(
        Part,
        partFixture({
          mpn: 'AP62200WU-7',
          status: 'verified',
          parameters: withConfidence(buckParameters(), 'verified'),
        }),
        'Part',
      ),
    ];
    const unfinished = (id: number, kind: string, promptVersion: string): Run =>
      parseOrThrow(
        Run,
        {
          id: uuid(id),
          mpn: 'LM5164DDAR',
          kind,
          promptVersion,
          model: 'claude-opus-5',
          startedAt: '2026-09-13T00:00:00Z',
        },
        'Run',
      );
    const cost = valueCost(parts, [
      ...runs,
      unfinished(60, 'extract', 'extract.v1'),
      unfinished(61, 'verify', 'verify.v1'),
    ]);
    expect(cost).toMatchObject({
      parts: 2,
      parametersStated: 56,
      parametersVerified: 30,
      verificationUsd: 0.45,
    });
    expect(cost.extractionUsd).toBeCloseTo(7.68, 10);
    expect(cost.perPart).toBeCloseTo(4.065, 10);
    expect(cost.perStatedParameter).toBeCloseTo(8.13 / 56, 10);
    expect(cost.perVerifiedParameter).toBeCloseTo(0.015, 10);
  });

  it('costs nothing per nothing rather than failing', () => {
    expect(valueCost([], [])).toMatchObject({
      perPart: 0,
      perStatedParameter: 0,
      perVerifiedParameter: 0,
    });
  });
});

describe('estimateSweep', () => {
  it('projects from what runs of that kind have cost', () => {
    const estimate = estimateSweep(runs, 22, 'extract');
    expect(estimate.basis).toBe(2);
    expect(estimate.meanCostUsd).toBeCloseTo(3.84, 10);
    expect(estimate.estimateUsd).toBeCloseTo(84.48, 10);
    expect(estimate.worstCaseUsd).toBeGreaterThan(estimate.estimateUsd);
  });

  it('estimates nothing when it has nothing to go on', () => {
    expect(estimateSweep([], 22, 'verify')).toStrictEqual({
      parts: 22,
      basis: 0,
      meanCostUsd: 0,
      p90CostUsd: 0,
      estimateUsd: 0,
      worstCaseUsd: 0,
    });
  });
});

describe('sessionTree', () => {
  it('nests a call under the call that caused it', () => {
    const parent = call({ id: uuid(40), tool: 'fetch_offers' });
    const gate = call({ id: uuid(41), tool: 'spend_gate', parentId: uuid(40) });
    const orphan = call({ id: uuid(42), tool: 'read_pages', parentId: uuid(99) });
    const tree = sessionTree([parent, gate, orphan]);
    expect(tree).toHaveLength(2);
    expect(tree[0]?.children[0]?.record.id).toBe(uuid(41));
    expect(tree[1]?.record.tool).toBe('read_pages');
  });

  it('nests siblings under one parent', () => {
    const parent = call({ id: uuid(50), tool: 'extract_part' });
    const tree = sessionTree([
      parent,
      call({ id: uuid(51), tool: 'read_pages', parentId: uuid(50) }),
      call({ id: uuid(52), tool: 'upsert_part', parentId: uuid(50) }),
    ]);
    expect(tree[0]?.children).toHaveLength(2);
  });

  it('has no tree for no calls', () => {
    expect(sessionTree([])).toStrictEqual([]);
  });
});
