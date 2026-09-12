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
import { EXCLUSIONS, buildSnapshot } from './build.js';

let api: TestApi;

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
    }),
  );
  storeRun({
    id: '00000000-0000-4000-8000-000000000001',
    mpn: 'TPS54331DR',
    costUsd: 3.41,
    turns: 18,
  });
  await api.appendLedger([
    toolCallRecord({ id: '00000000-0000-4000-8000-000000000010', tool: 'read_pages' }),
  ]);
});

afterEach(async () => {
  await api.close();
});

describe('buildSnapshot', () => {
  it('carries the measurements this project made', async () => {
    const snapshot = await buildSnapshot(api.deps, {
      now: () => new Date('2026-09-12T00:00:00.000Z'),
    });
    expect(snapshot).toMatchObject({
      takenAt: '2026-09-12T00:00:00.000Z',
      source: 'live',
      version: '1.0.0-test',
    });
    expect(snapshot.totals.parts).toBe(2);
    expect(snapshot.runs.runs).toBe(1);
    expect(snapshot.value.perPart).toBeCloseTo(1.705, 10);
    expect(snapshot.coverage).toHaveLength(30);
    expect(snapshot.parts.map((part) => part.mpn)).toStrictEqual(['AP62200WU-7', 'TPS54331DR']);
    expect(snapshot.tools[0]).toMatchObject({ tool: 'read_pages', calls: 1 });
    expect(snapshot.spend).toHaveLength(1);
    expect(snapshot.spendByModel[0]?.key).toBe('claude-opus-5');
  });

  it('measures the spend by the hour when it all happened inside one day', async () => {
    storeRun({
      id: '00000000-0000-4000-8000-000000000003',
      mpn: 'LM5164DDAR',
      startedAt: '2026-09-10T09:00:00.000Z',
      endedAt: '2026-09-10T09:20:00.000Z',
      costUsd: 2.2,
      turns: 9,
    });
    const snapshot = await buildSnapshot(api.deps);
    expect(snapshot.spend.map((point) => point.key)).toStrictEqual([
      '2026-09-10T00:00',
      '2026-09-10T09:00',
    ]);
  });

  it('measures it by the day once there is more than one day to show', async () => {
    storeRun({
      id: '00000000-0000-4000-8000-000000000004',
      mpn: 'LM5164DDAR',
      startedAt: '2026-09-11T09:00:00.000Z',
      endedAt: '2026-09-11T09:20:00.000Z',
      costUsd: 2.2,
      turns: 9,
    });
    const snapshot = await buildSnapshot(api.deps);
    expect(snapshot.spend.map((point) => point.key)).toStrictEqual(['2026-09-10', '2026-09-11']);
  });

  it('reads whichever database it is pointed at', async () => {
    await expect(buildSnapshot(api.deps, { source: 'nowhere' })).rejects.toThrow(
      expect.objectContaining({ code: 'WEB_SOURCE_NOT_FOUND' }),
    );
  });

  it('carries a price only where it is in the currency the page states', async () => {
    const snapshot = await buildSnapshot(api.deps);
    const part = snapshot.parts.find((one) => one.mpn === 'TPS54331DR');
    expect(part?.bestPriceAud).toBe(1.42);
  });

  it('leaves out a price quoted in another currency rather than converting it', async () => {
    api.repositories.parts.upsertPart(
      partFixture({
        mpn: 'LM5164DDAR',
        offers: [
          {
            ...(partFixture().offers as Loose[])[0],
            currency: 'USD',
          },
        ],
      }),
    );
    const snapshot = await buildSnapshot(api.deps);
    expect(snapshot.parts.find((one) => one.mpn === 'LM5164DDAR')?.bestPriceAud).toBeNull();
  });

  it('says on the record what it is leaving out', async () => {
    const snapshot = await buildSnapshot(api.deps);
    expect(snapshot.excluded).toStrictEqual(EXCLUSIONS);
    expect(snapshot.excluded.join(' ')).toMatch(/credentials/u);
    expect(snapshot.excluded.join(' ')).toMatch(/copyright/u);
  });

  it('carries no tool input, no tool output and no page text', async () => {
    const snapshot = await buildSnapshot(api.deps);
    const serialised = JSON.stringify(snapshot);
    expect(serialised).not.toContain('ORDERING INFORMATION');
    expect(serialised).not.toContain('"input"');
    expect(serialised).not.toContain('"output"');
    expect(serialised).not.toContain('296-28446-1-ND');
  });
});
