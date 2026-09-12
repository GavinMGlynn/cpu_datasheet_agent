import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  finishedRun,
  run as runFixture,
  toolCallRecord,
  type Loose,
} from '../../../test/helpers/core-fixtures.js';
import type { RunResult } from '../../core/run.js';
import { createTestApi, type TestApi } from '../../../test/helpers/web-api.js';
import { registerRuns } from './runs.js';

let api: TestApi;

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function storeRun(overrides: Loose): void {
  const started = runFixture({
    ...overrides,
    endedAt: undefined,
    turns: undefined,
    costUsd: undefined,
    result: undefined,
    details: undefined,
  });
  api.repositories.runs.start(started);
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
  api = await createTestApi({ register: registerRuns });
  storeRun({
    id: uuid(1),
    mpn: 'TPS54331DR',
    kind: 'extract',
    sessionId: 'session-a',
    costUsd: 3.41,
  });
  storeRun({
    id: uuid(2),
    mpn: 'AP62200WU-7',
    kind: 'verify',
    promptVersion: 'verify.v1',
    model: 'claude-haiku-4-5',
    sessionId: 'session-b',
    result: 'verified',
    costUsd: 0.45,
  });
  await api.appendLedger([
    toolCallRecord({
      id: uuid(10),
      sessionId: 'session-a',
      tool: 'resolve_mpn',
      startedAt: '2026-09-11T09:00:00Z',
    }),
    toolCallRecord({
      id: uuid(11),
      sessionId: 'session-a',
      parentId: uuid(10),
      tool: 'fetch_offers',
      spendsQuota: true,
      startedAt: '2026-09-11T09:00:05Z',
    }),
    toolCallRecord({
      id: uuid(12),
      sessionId: 'session-b',
      tool: 'read_pages',
      output: undefined,
      error: { name: 'PdfError', code: 'PDF_PAGE_MISSING', message: 'no page', details: {} },
      startedAt: '2026-09-11T10:00:00Z',
    }),
  ]);
});

afterEach(async () => {
  await api.close();
});

describe('GET /api/runs', () => {
  it('lists runs with the total behind the page', async () => {
    const result = await api.get('/api/runs');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ source: 'live', total: 2 });
  });

  it('filters by part, kind, result, prompt, model and whether it finished', async () => {
    const count = async (url: string): Promise<number> =>
      ((await api.get(url)).body as { total: number }).total;
    expect(await count('/api/runs?mpn=TPS54331DR')).toBe(1);
    expect(await count('/api/runs?kind=verify')).toBe(1);
    expect(await count('/api/runs?result=verified')).toBe(1);
    expect(await count('/api/runs?promptVersion=verify.v1')).toBe(1);
    expect(await count('/api/runs?model=claude-haiku-4-5')).toBe(1);
    expect(await count('/api/runs?finished=true')).toBe(2);
    expect(await count('/api/runs?finished=false')).toBe(0);
  });

  it('refuses a filter value it does not know', async () => {
    expect((await api.get('/api/runs?kind=guess')).status).toBe(400);
  });
});

describe('GET /api/runs/:id', () => {
  it('returns the run with the calls it made and their shape', async () => {
    const result = await api.get(`/api/runs/${uuid(1)}`);
    expect(result.status).toBe(200);
    const body = result.body as {
      run: { mpn: string };
      calls: unknown[];
      tree: { record: { id: string }; children: unknown[] }[];
    };
    expect(body.run.mpn).toBe('TPS54331DR');
    expect(body.calls).toHaveLength(2);
    expect(body.tree).toHaveLength(1);
    expect(body.tree[0]?.children).toHaveLength(1);
  });

  it('returns a run whose session left no trace, without pretending otherwise', async () => {
    storeRun({ id: uuid(3), mpn: 'LM5164DDAR', sessionId: undefined });
    const result = await api.get(`/api/runs/${uuid(3)}`);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ calls: [], tree: [] });
  });

  it('says when there is no such run', async () => {
    const result = await api.get(`/api/runs/${uuid(99)}`);
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: { code: 'WEB_RUN_NOT_FOUND' } });
  });
});

describe('GET /api/ledger', () => {
  it('pages through every call', async () => {
    const result = await api.get('/api/ledger?limit=2');
    expect(result.body).toMatchObject({ total: 3, limit: 2 });
    expect((result.body as { items: unknown[] }).items).toHaveLength(2);
  });

  it('filters by session, tool, parent, failure, spending, text and time', async () => {
    const count = async (url: string): Promise<number> =>
      ((await api.get(url)).body as { total: number }).total;
    expect(await count('/api/ledger?sessionId=session-a')).toBe(2);
    expect(await count('/api/ledger?tool=read_pages')).toBe(1);
    expect(await count(`/api/ledger?parentId=${uuid(10)}`)).toBe(1);
    expect(await count('/api/ledger?failed=true')).toBe(1);
    expect(await count('/api/ledger?spendsQuota=true')).toBe(1);
    expect(await count('/api/ledger?text=resolve')).toBe(1);
    expect(await count('/api/ledger?from=2026-09-11T09:30:00Z')).toBe(1);
    expect(await count('/api/ledger?to=2026-09-11T09:30:00Z')).toBe(2);
  });

  it('lists the tools, the sessions and the totals', async () => {
    const result = await api.get('/api/ledger/tools');
    expect(result.body).toMatchObject({
      tools: ['fetch_offers', 'read_pages', 'resolve_mpn'],
      sessions: ['session-a', 'session-b'],
      totals: { records: 3, failures: 1, spending: 1, malformed: 0 },
      malformed: [],
    });
  });
});

describe('one call, and one session', () => {
  it('returns a call with its children', async () => {
    const result = await api.get(`/api/ledger/${uuid(10)}`);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ blob: false });
    expect((result.body as { children: unknown[] }).children).toHaveLength(1);
  });

  it('reads back an output that was written to a blob', async () => {
    await api.appendLedger([
      toolCallRecord({
        id: uuid(20),
        sessionId: 'session-c',
        tool: 'read_pages',
        output: { $blob: { path: 'blobs/abc.json', sha256: 'a'.repeat(64), bytes: 12 } },
        startedAt: '2026-09-11T11:00:00Z',
      }),
    ]);
    await api.writeBlob('blobs/abc.json', JSON.stringify({ pages: ['page one'] }));
    const result = await api.get(`/api/ledger/${uuid(20)}`);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      blob: true,
      record: { output: { pages: ['page one'] } },
    });
  });

  it('returns a whole session as a tree', async () => {
    const result = await api.get('/api/ledger/sessions/session-a');
    expect(result.status).toBe(200);
    expect((result.body as { tree: unknown[] }).tree).toHaveLength(1);
  });

  it('says when a call or a session is not in the ledger', async () => {
    expect((await api.get(`/api/ledger/${uuid(98)}`)).status).toBe(404);
    const session = await api.get('/api/ledger/sessions/nobody');
    expect(session.status).toBe(404);
    expect(session.body).toMatchObject({ error: { code: 'WEB_SESSION_NOT_FOUND' } });
  });
});

describe('payload shapes', () => {
  it('keeps the shape of a run listing and of a call', async () => {
    const runs = (await api.get('/api/runs?limit=1&mpn=TPS54331DR')).body as { items: unknown[] };
    expect(runs.items[0]).toMatchSnapshot();
    const call = (await api.get(`/api/ledger/${uuid(10)}`)).body as {
      record: Record<string, unknown>;
    };
    expect(Object.keys(call.record).sort()).toMatchSnapshot();
  });
});
