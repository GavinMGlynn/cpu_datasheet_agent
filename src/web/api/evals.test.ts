import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { finishedRun } from '../../../test/helpers/core-fixtures.js';
import { createTestApi, type TestApi } from '../../../test/helpers/web-api.js';
import { Run } from '../../core/run.js';
import { parseOrThrow } from '../../core/validation-error.js';
import type { EvalResult, PartResult } from '../../eval/harness.js';
import { loadGoldenSet } from '../../eval/load.js';
import { REPORT_FILE, SUMMARY_FILE, toReport, type EvalReport } from '../../eval/report.js';
import { scorePart, scoreSet } from '../../eval/scorer.js';
import type { ParameterSet } from '../../reconcile/types.js';
import { registerEvals } from './evals.js';

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

const V1 = '2026-09-11T00-00-00-000Z-extract.v1-claude-opus-5';
const V2 = '2026-09-12T00-00-00-000Z-extract.v2-claude-opus-5';

let api: TestApi;
let resultsDir: string;

beforeEach(async () => {
  resultsDir = await mkdtemp(path.join(tmpdir(), 'chip-web-eval-results-'));
  const write = async (id: string, report: EvalReport, summary?: string): Promise<void> => {
    await mkdir(path.join(resultsDir, id), { recursive: true });
    await writeFile(path.join(resultsDir, id, REPORT_FILE), JSON.stringify(report));
    if (summary !== undefined) {
      await writeFile(path.join(resultsDir, id, SUMMARY_FILE), summary);
    }
  };
  await write(V1, reportOf(reference.part.parameters), '# Evaluation extract.v1');
  await write(
    V2,
    reportOf(
      {
        ...reference.part.parameters,
        vinMax: { ...reference.part.parameters.vinMax, value: { value: 999, unit: 'V' } },
      },
      { promptVersion: 'extract.v2' },
    ),
  );
  api = await createTestApi({ register: registerEvals, resultsDir });
});

afterEach(async () => {
  await api.close();
  await rm(resultsDir, { recursive: true, force: true });
});

describe('GET /api/evals', () => {
  it('lists every result, newest first', async () => {
    const result = await api.get('/api/evals');
    expect(result.status).toBe(200);
    const body = result.body as { results: { id: string; recall: number }[] };
    expect(body.results.map((entry) => entry.id)).toStrictEqual([V2, V1]);
    expect(body.results[1]?.recall).toBe(1);
  });

  it('returns one report, its summary, its parameters and its failures', async () => {
    expect(((await api.get(`/api/evals/${V1}`)).body as { id: string }).id).toBe(V1);
    const summary = await api.get(`/api/evals/${V1}/summary`);
    expect(summary.headers['Content-Type']).toBe('text/markdown; charset=utf-8');
    expect(summary.text).toBe('# Evaluation extract.v1');
    const parameters = (await api.get(`/api/evals/${V2}/parameters`)).body as {
      parameters: { key: string; accuracy: number }[];
    };
    expect(parameters.parameters[0]?.key).toBe('vinMax');
    const failures = (await api.get(`/api/evals/${V2}/failures`)).body as {
      failures: { key: string }[];
    };
    expect(failures.failures.map((row) => row.key)).toContain('vinMax');
  });

  it('compares two results without re-scoring either', async () => {
    const result = await api.get(`/api/evals/compare?from=${V1}&to=${V2}`);
    expect(result.status).toBe(200);
    const body = result.body as { comparison: { regressions: { key: string }[] } };
    expect(body.comparison.regressions.map((change) => change.key)).toContain('vinMax');
  });

  it('refuses a comparison missing an end, and 404s a result it does not have', async () => {
    expect((await api.get(`/api/evals/compare?from=${V1}`)).status).toBe(400);
    expect((await api.get('/api/evals/nothing')).status).toBe(404);
    expect((await api.get('/api/evals/nothing/summary')).status).toBe(404);
    expect((await api.get('/api/evals/nothing/parameters')).status).toBe(404);
    expect((await api.get('/api/evals/nothing/failures')).status).toBe(404);
  });

  it('refuses a result id that is a path', async () => {
    expect((await api.get('/api/evals/..%2Fsecrets')).status).toBe(400);
  });
});

describe('the golden set', () => {
  it('lists every part with who read it and when', async () => {
    const result = await api.get('/api/golden');
    const body = result.body as { parts: { mpn: string; readBy: string; reason: string }[] };
    expect(body.parts).toHaveLength(golden.length);
    expect(body.parts[0]?.readBy.length).toBeGreaterThan(0);
  });

  it('returns one part in full', async () => {
    const result = await api.get(`/api/golden/${encodeURIComponent(reference.part.mpn)}`);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ file: reference.file, part: { mpn: reference.part.mpn } });
  });

  it('says when a part is not in the set', async () => {
    const result = await api.get('/api/golden/NOTHING-1');
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: { code: 'WEB_GOLDEN_NOT_FOUND' } });
  });

  it('reports the health of the set', async () => {
    const result = await api.get('/api/golden/health');
    expect(result.body).toMatchObject({ parts: golden.length, issues: [], thin: [] });
  });
});

describe('payload shapes', () => {
  it('keeps the shape of a listing row and of a parameter score', async () => {
    const listing = (await api.get('/api/evals')).body as { results: unknown[] };
    expect(listing.results[1]).toMatchSnapshot();
    const parameters = (await api.get(`/api/evals/${V2}/parameters`)).body as {
      parameters: unknown[];
    };
    expect(parameters.parameters[0]).toMatchSnapshot();
  });
});
