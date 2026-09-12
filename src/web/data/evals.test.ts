import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { finishedRun } from '../../../test/helpers/core-fixtures.js';
import { Run } from '../../core/run.js';
import { parseOrThrow } from '../../core/validation-error.js';
import type { EvalResult, PartResult } from '../../eval/harness.js';
import { loadGoldenSet } from '../../eval/load.js';
import { REPORT_FILE, SUMMARY_FILE, toReport, type EvalReport } from '../../eval/report.js';
import { scorePart, scoreSet } from '../../eval/scorer.js';
import type { ParameterSet } from '../../reconcile/types.js';
import { createEvals, failures, parameterScores, type Evals } from './evals.js';

const golden = loadGoldenSet();
const first = golden[0];
if (first === undefined) {
  throw new Error('the golden set is empty');
}
const reference = first;

function reportOf(parameters: ParameterSet, overrides: Partial<EvalResult> = {}): EvalReport {
  const run = parseOrThrow(Run, finishedRun({ mpn: reference.part.mpn }), 'Run');
  const part = {
    mpn: reference.part.mpn,
    run,
    score: scorePart(reference.part, parameters),
    cacheMisses: 0,
  } as PartResult;
  return toReport({
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
  });
}

const perfect = reportOf(reference.part.parameters);
const wrong = reportOf(
  {
    ...reference.part.parameters,
    vinMax: { ...reference.part.parameters.vinMax, value: { value: 999, unit: 'V' } },
  },
  { promptVersion: 'extract.v2' },
);

let root: string;
let evals: Evals;

async function writeResult(id: string, report: EvalReport, summary?: string): Promise<void> {
  const dir = path.join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, REPORT_FILE), JSON.stringify(report));
  if (summary !== undefined) {
    await writeFile(path.join(dir, SUMMARY_FILE), summary);
  }
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'chip-web-evals-'));
  await writeResult('2026-09-11T16-00-31-043Z-extract.v1-claude-opus-5', perfect, '# summary');
  await writeResult('2026-09-12T02-00-00-000Z-extract.v2-claude-opus-5', wrong);
  await mkdir(path.join(root, 'not-a-result'), { recursive: true });
  evals = createEvals({ resultsDir: root });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('list', () => {
  it('lists every result, newest first, skipping directories with no report', async () => {
    const listed = await evals.list();
    expect(listed.map((entry) => entry.promptVersion)).toStrictEqual(['extract.v2', 'extract.v1']);
    expect(listed[1]).toMatchObject({
      model: 'claude-opus-5',
      parts: 1,
      recall: 1,
      precision: 1,
      costUsd: 0.42,
      turns: 12,
      starved: 0,
    });
  });

  it('has nothing to list when no evaluation has ever run', async () => {
    expect(await createEvals({ resultsDir: path.join(root, 'nowhere') }).list()).toStrictEqual([]);
  });
});

describe('report and summary', () => {
  it('reads a result back', async () => {
    const report = await evals.report('2026-09-11T16-00-31-043Z-extract.v1-claude-opus-5');
    expect(report.set.recall).toBe(1);
  });

  it('refuses an id that is a path', async () => {
    await expect(evals.report('../secrets')).rejects.toThrow(
      expect.objectContaining({ code: 'WEB_BAD_RESULT_ID', status: 400 }),
    );
    await expect(evals.report('a\\b')).rejects.toThrow(
      expect.objectContaining({ code: 'WEB_BAD_RESULT_ID' }),
    );
    await expect(evals.report('.hidden')).rejects.toThrow(
      expect.objectContaining({ code: 'WEB_BAD_RESULT_ID' }),
    );
  });

  it('says when a result or a summary is not there', async () => {
    await expect(evals.report('nothing')).rejects.toThrow(
      expect.objectContaining({ code: 'WEB_RESULT_NOT_FOUND', status: 404 }),
    );
    await expect(evals.summary('nothing')).rejects.toThrow(
      expect.objectContaining({ code: 'WEB_SUMMARY_NOT_FOUND', status: 404 }),
    );
  });

  it('reads the markdown summary beside the result', async () => {
    expect(await evals.summary('2026-09-11T16-00-31-043Z-extract.v1-claude-opus-5')).toBe(
      '# summary',
    );
  });

  it('compares two results', async () => {
    const comparison = await evals.compare(
      '2026-09-11T16-00-31-043Z-extract.v1-claude-opus-5',
      '2026-09-12T02-00-00-000Z-extract.v2-claude-opus-5',
    );
    expect(comparison.regressions.map((change) => change.key)).toContain('vinMax');
  });
});

describe('parameterScores', () => {
  it('puts the least reliable parameter first and names the parts that failed', () => {
    const rows = parameterScores(wrong);
    expect(rows[0]).toMatchObject({
      key: 'vinMax',
      correct: 0,
      stated: 1,
      accuracy: 0,
      wrongParts: [reference.part.mpn],
    });
    const vinMin = rows.find((row) => row.key === 'vinMin');
    expect(vinMin).toMatchObject({ correct: 1, accuracy: 1 });
    expect(vinMin?.citationExact).toBe(1);
  });

  it('names the parts where a value was missing altogether', () => {
    const { vinMin: _vinMin, ...withoutVinMin } = reference.part.parameters;
    const missing = reportOf(withoutVinMin);
    const row = parameterScores(missing).find((entry) => entry.key === 'vinMin');
    expect(row?.missingParts).toStrictEqual([reference.part.mpn]);
  });

  it('counts a citation that is one page out', () => {
    const offByOne = reportOf({
      ...reference.part.parameters,
      vinMin: {
        ...reference.part.parameters.vinMin,
        provenance:
          reference.part.parameters.vinMin.provenance.source === 'datasheet'
            ? {
                ...reference.part.parameters.vinMin.provenance,
                page: reference.part.parameters.vinMin.provenance.page + 1,
              }
            : reference.part.parameters.vinMin.provenance,
      },
    });
    const row = parameterScores(offByOne).find((entry) => entry.key === 'vinMin');
    expect(row?.citationWithinOne).toBe(1);
    expect(row?.citationExact).toBe(0);
  });
});

describe('failures', () => {
  it('lists what did not score correct, with both sides of the disagreement', () => {
    const rows = failures(wrong);
    const vinMax = rows.find((row) => row.key === 'vinMax');
    expect(vinMax).toMatchObject({ mpn: reference.part.mpn, score: 'wrong' });
    expect(vinMax?.actual).toStrictEqual({ value: 999, unit: 'V' });
  });

  it('has nothing to list for a perfect run', () => {
    expect(failures(perfect)).toStrictEqual([]);
  });
});

describe('golden', () => {
  it('loads the golden set and checks its health', () => {
    const health = createEvals({ resultsDir: root }).goldenHealth();
    expect(health.parts).toBe(golden.length);
    expect(health.issues).toStrictEqual([]);
    expect(health.thin).toStrictEqual([]);
    expect(Object.keys(health.coverage).length).toBeGreaterThan(0);
  });

  it('names the parameters with too few examples to measure', async () => {
    const thinDir = path.join(root, 'golden');
    await mkdir(thinDir, { recursive: true });
    await copyFile(
      path.join('eval', 'golden', reference.file),
      path.join(thinDir, reference.file),
    );
    const health = createEvals({ resultsDir: root, goldenDir: thinDir }).goldenHealth();
    expect(health.parts).toBe(1);
    expect(health.thin.length).toBeGreaterThan(0);
    expect(health.issues.length).toBeGreaterThan(0);
  });

  it('hands the loaded parts over for review', () => {
    expect(createEvals().golden()).toHaveLength(golden.length);
  });
});
