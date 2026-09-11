import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { finishedRun } from '../../test/helpers/core-fixtures.js';
import { PARAMETER_KEYS, Run, parseOrThrow } from '../core/index.js';
import type { EvalResult, PartResult } from './harness.js';
import { loadGoldenSet, type LoadedGolden } from './load.js';
import {
  EvalReport,
  REPORT_FILE,
  SUMMARY_FILE,
  readReport,
  renderMarkdown,
  resultDirName,
  toReport,
  writeReport,
} from './report.js';
import { scorePart, scoreSet } from './scorer.js';

const golden = loadGoldenSet();
const found = golden[0];
if (found === undefined) {
  throw new Error('the golden set is empty');
}
const first: LoadedGolden = found;

function partResult(overrides: Partial<PartResult> = {}): PartResult {
  const run = parseOrThrow(Run, finishedRun({ mpn: first.part.mpn }), 'Run');
  return {
    mpn: first.part.mpn,
    run: { ...run, endedAt: run.endedAt ?? '', turns: 12, costUsd: 0.42, result: 'extracted' },
    score: scorePart(first.part, first.part.parameters),
    cacheMisses: 0,
    ...overrides,
  } as PartResult;
}

function result(parts: readonly PartResult[] = [partResult()]): EvalResult {
  return {
    startedAt: '2026-09-11T00:00:00.000Z',
    endedAt: '2026-09-11T00:30:00.000Z',
    promptVersion: 'extract.v1',
    model: 'claude-opus-5',
    effort: 'high',
    parts,
    set: scoreSet(parts.map((part) => part.score)),
    turns: parts.reduce((sum, part) => sum + part.run.turns, 0),
    costUsd: parts.reduce((sum, part) => sum + part.run.costUsd, 0),
    starved: parts.filter((part) => part.cacheMisses > 0).map((part) => part.mpn),
  };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'report-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('toReport', () => {
  it('states each number once: the totals carry no copy of the part scores', () => {
    const report = toReport(result());

    expect(report.set).not.toHaveProperty('parts');
    expect(report.parts).toHaveLength(1);
    expect(report.set.byParameter.vinMax).toEqual({ correct: 1, stated: 1 });
  });

  it('keeps a value the golden set states and the run did not apart from one neither did', () => {
    const missing = { ...first.part.parameters };
    delete (missing as Record<string, unknown>).vinMax;

    const report = toReport(result([partResult({ score: scorePart(first.part, missing) })]));
    const vinMax = report.parts[0]?.score.parameters.find((one) => one.key === 'vinMax');
    const absent = report.parts[0]?.score.parameters.find((one) => one.score === 'absent');

    expect(vinMax?.score).toBe('missing');
    expect(vinMax?.actual).toBeUndefined();
    expect(absent?.expected ?? null).toBeNull();
  });
});

describe('resultDirName', () => {
  it('sorts by time and says what produced it', () => {
    expect(resultDirName(result())).toBe('2026-09-11T00-00-00-000Z-extract.v1-claude-opus-5');
  });
});

describe('renderMarkdown', () => {
  it('states the prompt version and the model, which is what a score is about', () => {
    const markdown = renderMarkdown(toReport(result()));

    expect(markdown).toContain('`extract.v1`');
    expect(markdown).toContain('`claude-opus-5` at effort `high`');
    expect(markdown).toContain('| Recall | 100.0%');
    expect(markdown).toContain(first.part.mpn);
    expect(markdown).toContain('None.');
  });

  it('names the parts that went hungry, and every value that was wrong', () => {
    const wrong = {
      ...first.part.parameters,
      vinMax: { ...first.part.parameters.vinMax, value: { value: 999, unit: 'V' as const } },
    };

    const markdown = renderMarkdown(
      toReport(result([partResult({ score: scorePart(first.part, wrong), cacheMisses: 2 })])),
    );

    expect(markdown).toContain('wanted something the cache did not have');
    expect(markdown).toContain('| vinMax | wrong |');
    expect(markdown).toContain('999');
  });
});

describe('writeReport and readReport', () => {
  it('writes both files and reads the JSON back unchanged', async () => {
    const report = toReport(result());

    const written = await writeReport(report, dir);

    expect(path.basename(written)).toBe(resultDirName(report));
    expect(await readReport(written)).toEqual(report);
    expect(await readFile(path.join(written, SUMMARY_FILE), 'utf8')).toBe(renderMarkdown(report));
    expect(JSON.parse(await readFile(path.join(written, REPORT_FILE), 'utf8'))).toMatchObject({
      promptVersion: 'extract.v1',
    });
  });

  it('refuses a file that is not a report', async () => {
    const report = toReport(result());
    const written = await writeReport(report, dir);
    await rm(path.join(written, REPORT_FILE));
    await writeReport({ ...report, parts: [] }, dir);

    expect((await readReport(written)).parts).toEqual([]);
    expect(() => EvalReport.parse({ promptVersion: 'extract.v1' })).toThrow();
  });

  it('covers every parameter in the totals', () => {
    expect(Object.keys(toReport(result()).set.byParameter).sort()).toEqual(
      [...PARAMETER_KEYS].sort(),
    );
  });
});
