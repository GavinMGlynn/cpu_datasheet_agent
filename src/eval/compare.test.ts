import { describe, expect, it } from 'vitest';

import { finishedRun } from '../../test/helpers/core-fixtures.js';
import { Run, parseOrThrow } from '../core/index.js';
import { compareReports, renderComparison } from './compare.js';
import { loadGoldenSet, type LoadedGolden } from './load.js';
import { toReport, type EvalReport } from './report.js';
import { scorePart, scoreSet } from './scorer.js';
import type { EvalResult, PartResult } from './harness.js';

const golden = loadGoldenSet();
const found = golden[0];
if (found === undefined) {
  throw new Error('the golden set is empty');
}
const first: LoadedGolden = found;

type Parameters = (typeof first)['part']['parameters'];

function reportOf(parameters: Parameters, overrides: Partial<EvalResult> = {}): EvalReport {
  const run = parseOrThrow(Run, finishedRun({ mpn: first.part.mpn }), 'Run');
  const part: PartResult = {
    mpn: first.part.mpn,
    run: { ...run, endedAt: run.endedAt ?? '', turns: 12, costUsd: 0.42, result: 'extracted' },
    score: scorePart(first.part, parameters),
    cacheMisses: 0,
  } as PartResult;
  const result: EvalResult = {
    startedAt: '2026-09-11T00:00:00.000Z',
    endedAt: '2026-09-11T00:30:00.000Z',
    promptVersion: 'extract.v1',
    model: 'claude-opus-5',
    effort: 'high',
    parts: [part],
    set: scoreSet([part.score]),
    turns: 12,
    costUsd: 0.42,
    starved: [],
    ...overrides,
  };
  return toReport(result);
}

const perfect = reportOf(first.part.parameters);

describe('compareReports', () => {
  it('finds nothing to say about two identical runs', () => {
    const comparison = compareReports(perfect, perfect);

    expect(comparison.regressions).toEqual([]);
    expect(comparison.improvements).toEqual([]);
    expect(comparison.totals.recall).toEqual([1, 1]);
  });

  it('flags a value that stopped being right', () => {
    const wrong = reportOf({
      ...first.part.parameters,
      vinMax: { ...first.part.parameters.vinMax, value: { value: 999, unit: 'V' } },
    });

    const comparison = compareReports(perfect, wrong);

    expect(comparison.regressions).toEqual([
      expect.objectContaining({ key: 'vinMax', from: 'correct', to: 'wrong' }),
    ]);
    expect(comparison.improvements).toEqual([]);
    expect(compareReports(wrong, perfect).improvements).toHaveLength(1);
  });

  it('flags a citation that drifted even though the value stayed right', () => {
    const provenance = first.part.parameters.vinMax.provenance;
    const page = provenance.source === 'datasheet' ? provenance.page : 1;
    const drifted = reportOf({
      ...first.part.parameters,
      vinMax: {
        ...first.part.parameters.vinMax,
        provenance: { ...provenance, page: page + 1 },
      },
    } as Parameters);

    const comparison = compareReports(perfect, drifted);

    expect(comparison.regressions).toEqual([
      expect.objectContaining({ key: 'vinMax', fromPage: 'exact', toPage: 'within_one' }),
    ]);
  });

  it('lists the parts only one run covered rather than counting them', () => {
    const empty = reportOf(first.part.parameters, { parts: [], set: scoreSet([]) });

    expect(compareReports(perfect, empty).onlyInFrom).toEqual([first.part.mpn]);
    expect(compareReports(empty, perfect).onlyInTo).toEqual([first.part.mpn]);
    expect(compareReports(perfect, empty).regressions).toEqual([]);
  });
});

describe('renderComparison', () => {
  it('reads as a before and after', () => {
    const wrong = reportOf({
      ...first.part.parameters,
      vinMax: { ...first.part.parameters.vinMax, value: { value: 999, unit: 'V' } },
    });

    const rendered = renderComparison(compareReports(perfect, wrong));

    expect(rendered).toContain('extract.v1 / claude-opus-5  →  extract.v1 / claude-opus-5');
    expect(rendered).toContain('recall     100.0% →');
    expect(rendered).toContain('cost       $0.42 → $0.42');
    expect(rendered).toContain(`worse  ${first.part.mpn} vinMax: correct/exact → wrong/exact`);
  });

  it('says when the two runs covered different parts', () => {
    const empty = reportOf(first.part.parameters, { parts: [], set: scoreSet([]) });

    expect(renderComparison(compareReports(perfect, empty))).toContain('parts in one run only');
  });

  it('reports an improvement as plainly as a regression', () => {
    const wrong = reportOf({
      ...first.part.parameters,
      vinMax: { ...first.part.parameters.vinMax, value: { value: 999, unit: 'V' } },
    });

    expect(renderComparison(compareReports(wrong, perfect))).toContain('better');
  });
});
