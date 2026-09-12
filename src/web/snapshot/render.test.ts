import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buckParameters,
  finishedRun,
  part as partFixture,
  run as runFixture,
  toolCallRecord,
  withConfidence,
  type Loose,
} from '../../../test/helpers/core-fixtures.js';
import { createTestApi, type TestApi } from '../../../test/helpers/web-api.js';
import type { RunResult } from '../../core/run.js';
import { elementAt } from '../../util/array.js';
import type { EvalListing } from '../data/evals.js';
import { buildSnapshot, type Snapshot } from './build.js';
import { renderSnapshot } from './render.js';

/**
 * The snapshot page is the one artefact that leaves this machine, so these
 * tests are as much about what it must not contain as about what it shows.
 */

let api: TestApi;
let base: Snapshot;

const evaluation: EvalListing = {
  id: '2026-09-11T02-00-00Z-extract.v1-claude-opus-5',
  promptVersion: 'extract.v1',
  model: 'claude-opus-5',
  startedAt: '2026-09-11T02:00:00.000Z',
  parts: 22,
  recall: 0.906,
  precision: 0.906,
  provenanceAccuracy: 0.593,
  withinOnePage: 0.781,
  costUsd: 87.24,
  turns: 640,
  starved: 0,
};

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
  };
  api.repositories.runs.finish(finished.id, {
    endedAt: finished.endedAt,
    turns: finished.turns,
    costUsd: finished.costUsd,
    result: finished.result,
    details: finished.details,
  });
}

beforeEach(async () => {
  api = await createTestApi({ register: () => undefined });
  api.repositories.parts.upsertPart(partFixture());
  api.repositories.parts.upsertPart(
    partFixture({
      mpn: 'AP62200WU-7',
      manufacturer: 'Diodes Incorporated',
      status: 'verified',
      parameters: withConfidence(buckParameters(), 'verified'),
      offers: [],
    }),
  );
  storeRun({
    id: '00000000-0000-4000-8000-000000000001',
    mpn: 'TPS54331DR',
    startedAt: '2026-09-10T02:00:00.000Z',
    endedAt: '2026-09-10T02:20:00.000Z',
    costUsd: 3.41,
    turns: 18,
  });
  storeRun({
    id: '00000000-0000-4000-8000-000000000002',
    mpn: 'AP62200WU-7',
    startedAt: '2026-09-11T02:00:00.000Z',
    endedAt: '2026-09-11T02:20:00.000Z',
    costUsd: 1.56,
    turns: 11,
  });
  await api.appendLedger([
    toolCallRecord({ id: '00000000-0000-4000-8000-000000000010', tool: 'read_pages' }),
    toolCallRecord({
      id: '00000000-0000-4000-8000-000000000011',
      tool: 'normalise_value',
      output: undefined,
      error: {
        name: 'ChipAgentError',
        code: 'UNIT_PARSE_FAILED',
        message: 'cannot parse "3 V to 32 V"',
        details: {},
      },
    }),
  ]);
  base = await buildSnapshot(api.deps, { now: () => new Date('2026-09-12T00:00:00.000Z') });
});

afterEach(async () => {
  await api.close();
});

describe('renderSnapshot', () => {
  it('states what was measured, when, and by which version', () => {
    const html = renderSnapshot(base);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('2026-09-12T00:00:00.000Z');
    expect(html).toContain('1.0.0-test');
    expect(html).toContain('$4.97');
    expect(html).toContain('TPS54331DR');
    expect(html).toContain('read_pages');
  });

  it('draws the spend as one point a day for each series', () => {
    const html = renderSnapshot(base);
    // Two days, two series: the daily figure and the running total.
    expect(html.match(/<circle /gu)).toHaveLength(4);
    expect(html.match(/<polyline /gu)).toHaveLength(2);
    expect(html).toContain('spent in total');
    expect(html).toContain('spent that day');
    expect(html).toContain('what it cost, day by day');
  });

  it('names the hour when that is what a point covers', () => {
    const html = renderSnapshot({ ...base, spendGranularity: 'hour' });
    expect(html).toContain('spent that hour');
    expect(html).toContain('what it cost, hour by hour');
  });

  it('says nothing has been spent rather than drawing an empty chart', () => {
    const html = renderSnapshot({ ...base, spend: [] });
    expect(html).toContain('nothing has been spent');
    expect(html).not.toContain('<polyline ');
  });

  it('places a single day without dividing by the gap it does not have', () => {
    const html = renderSnapshot({ ...base, spend: [elementAt(base.spend, 0)] });
    expect(html.match(/<circle /gu)).toHaveLength(2);
    expect(html).toContain('cx="60"');
    expect(html).not.toContain('NaN');
  });

  it('keeps the line on the axis when nothing a day cost anything', () => {
    const flat = base.spend.map((point) => ({ ...point, costUsd: 0, cumulativeUsd: 0 }));
    const html = renderSnapshot({ ...base, spend: flat });
    expect(html).toContain('$0.00');
    expect(html).not.toContain('NaN');
  });

  it('shades the coverage grid by how many parts state each parameter', () => {
    const html = renderSnapshot(base);
    expect(html).toContain('class="heat"');
    expect(html).toContain('vinMin');
  });

  it('turns the ink white where the shading is too dark to read through', () => {
    // Both parts state vinMin, so that cell is the top of the ramp; nothing
    // states rdsOnLow, so that one is the bottom.
    const html = renderSnapshot(base);
    expect(html).toContain('class="heat on"');
    expect(html).toMatch(/<td class="heat" style="background:#cde2fb">0<\/td>/u);
  });

  it('shades nothing rather than dividing by zero when no part is stored', () => {
    const html = renderSnapshot({ ...base, totals: { ...base.totals, parts: 0 } });
    expect(html).toContain('of 0 parts');
    expect(html).not.toContain('NaN');
  });

  it('escapes what it interpolates', () => {
    const html = renderSnapshot({ ...base, source: '<script>alert(1)</script> & co' });
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp; co');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('shows the most recent evaluation when one has been run', () => {
    const html = renderSnapshot({ ...base, evaluations: [evaluation] });
    expect(html).toContain('extract.v1');
    expect(html).toContain('90.6%');
    expect(html).toContain('59.3%');
    expect(html).toContain('$87.24');
  });

  it('says so when the golden set has never been scored', () => {
    expect(base.evaluations).toStrictEqual([]);
    expect(renderSnapshot(base)).toContain('no evaluation has been run');
  });

  it('prints a dash where there is no price and where nothing failed', () => {
    const html = renderSnapshot(base);
    // AP62200WU-7 is stored without an offer, and read_pages never failed.
    expect(html.match(/<td>—<\/td>/gu)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('AUD 1.420');
  });

  it('is self-contained: nothing to fetch, nothing to run', () => {
    const html = renderSnapshot({ ...base, evaluations: [evaluation] });
    expect(html).not.toContain('<script');
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
    expect(html).not.toContain('src=');
  });

  it('carries no datasheet text, no tool payload and no distributor part number', () => {
    const html = renderSnapshot(base);
    expect(html).not.toContain('ORDERING INFORMATION');
    expect(html).not.toContain('296-28446-1-ND');
    expect(html).toContain('manufacturers’ copyright');
  });
});
