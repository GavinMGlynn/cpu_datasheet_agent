import type { PartSummary, ParameterRow, Run } from '../../src/web/ui/lib/types.js';

/** Answers shaped like the server's, for the page tests. */

/** Overrides that may explicitly clear an optional field. */
type SummaryOverrides = Partial<{ -readonly [K in keyof PartSummary]: PartSummary[K] | undefined }>;

export function summary(overrides: SummaryOverrides = {}): PartSummary {
  return {
    mpn: 'TPS54331DR',
    manufacturer: 'Texas Instruments',
    category: 'buck_regulator',
    status: 'extracted',
    createdAt: '2026-09-11T10:00:00Z',
    updatedAt: '2026-09-11T10:31:00Z',
    datasheet: { sha256: 'a'.repeat(64), url: 'https://example.invalid/ds.pdf', pageCount: 40 },
    parameters: { stated: 28, cited: 30, verified: 0, conflicted: 0, total: 30 },
    verdicts: { confirmed: 0, contradicted: 0, notFound: 0, unchecked: 30 },
    classifications: { vinClass: 'le_42v' },
    offerCount: 1,
    distributors: ['digikey'],
    stock: 12_000,
    bestPrice: {
      amount: 1.42,
      currency: 'AUD',
      breakQuantity: 100,
      distributor: 'digikey',
      sku: '296-1',
      stock: 12_000,
    },
    headline: {
      vinMin: { value: 3.5, unit: 'V' },
      vinMax: { value: 28, unit: 'V' },
      ioutMax: { value: 3, unit: 'A' },
      switchingFrequency: { value: 570_000, unit: 'Hz' },
      package: 'SOIC-8',
    },
    ...overrides,
  } as PartSummary;
}

export function parameterRow(overrides: Partial<ParameterRow> = {}): ParameterRow {
  return {
    key: 'vinMax',
    value: { value: 28, unit: 'V' },
    confidence: 'extracted',
    provenance: { source: 'datasheet', page: 4, sha256: 'a'.repeat(64) },
    ...overrides,
  };
}

/** A run that started and never came back: every ending field absent. */
export function unfinishedRun(id: string): Run {
  return {
    id,
    mpn: 'TPS54331DR',
    kind: 'extract',
    promptVersion: 'extract.v1',
    model: 'claude-opus-5',
    startedAt: '2026-09-13T00:00:00Z',
  };
}

export function run(overrides: Partial<Run> = {}): Run {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    mpn: 'TPS54331DR',
    kind: 'extract',
    promptVersion: 'extract.v1',
    model: 'claude-opus-5',
    sessionId: 'session-a',
    startedAt: '2026-09-11T09:00:00Z',
    endedAt: '2026-09-11T09:04:00Z',
    turns: 18,
    costUsd: 3.41,
    result: 'extracted',
    details: {
      toolCalls: 19,
      toolFailures: [],
      escalations: 0,
      spendDenials: 0,
      cacheMisses: 0,
      stored: true,
      subtype: 'success',
    },
    ...overrides,
  };
}
