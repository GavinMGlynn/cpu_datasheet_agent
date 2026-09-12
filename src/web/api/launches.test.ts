import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import { assistantText, resultMessage, scriptedQuery } from '../../../test/helpers/agent-sdk.js';
import {
  finishedRun,
  part as partFixture,
  run as runFixture,
} from '../../../test/helpers/core-fixtures.js';
import { recordedRequest, recordedResponse } from '../../../test/helpers/web.js';
import { createTestApi, type TestApi } from '../../../test/helpers/web-api.js';
import type { RunResult } from '../../core/run.js';
import { registerApi } from './index.js';

let api: TestApi;

const MESSAGES: readonly SDKMessage[] = [
  assistantText('looking at the ordering table'),
  resultMessage({ numTurns: 5, costUsd: 0.42, text: 'nothing stored' }),
];

const launch = {
  kind: 'extract',
  mpns: ['TPS54331DR'],
  actor: 'gavin',
  reason: 'checking the run control works',
  ceilingUsd: 5,
  confirmed: true,
};

function storeRun(overrides: Record<string, unknown>): void {
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
  const { query } = scriptedQuery(MESSAGES);
  api = await createTestApi({ register: registerApi, query });
  api.repositories.parts.upsertPart(partFixture());
});

afterEach(async () => {
  await api.close();
});

describe('GET /api/launches/estimate', () => {
  it('says what a sweep would cost and how much history that rests on', async () => {
    storeRun({ id: '00000000-0000-4000-8000-000000000001', costUsd: 4, kind: 'extract' });
    const result = await api.get('/api/launches/estimate?kind=extract&parts=22');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      parts: 22,
      basis: 1,
      estimateUsd: 88,
      basisDescription: 'from 1 extract run(s) already recorded',
    });
  });

  it('admits when it has nothing to estimate from', async () => {
    const result = await api.get('/api/launches/estimate?kind=verify&parts=5');
    expect(result.body).toMatchObject({
      basis: 0,
      estimateUsd: 0,
      basisDescription: expect.stringContaining('nothing has been run yet') as unknown,
    });
  });
});

describe('POST /api/launches', () => {
  it('starts a run, answers 202 with the launch, and audits who asked', async () => {
    const result = await api.post('/api/launches', launch);
    expect(result.status).toBe(202);
    const body = result.body as {
      launch: { id: string; state: string };
      event: { action: string };
    };
    expect(body.launch.state).toBe('running');
    expect(body.event.action).toBe('run.launch');
    expect(api.repositories.audit.list()).toHaveLength(1);
  });

  it('refuses one that was never confirmed, and one with no ceiling', async () => {
    const { confirmed: _confirmed, ...unconfirmed } = launch;
    expect((await api.post('/api/launches', unconfirmed)).status).toBe(400);
    const { ceilingUsd: _ceiling, ...noCeiling } = launch;
    expect((await api.post('/api/launches', { ...noCeiling, confirmed: true })).status).toBe(400);
    expect(api.repositories.audit.list()).toStrictEqual([]);
  });

  it('refuses to launch against an evaluation database', async () => {
    expect((await api.post('/api/launches?source=nowhere', launch)).status).toBe(404);
  });

  it('needs the token in a header, not only a cookie', async () => {
    const response = recordedResponse();
    await api.request('POST', '/api/launches', launch);
    const withCookie = recordedRequest({
      method: 'POST',
      url: '/api/launches',
      headers: { cookie: `chip_session=${api.session.cookie}`, 'content-type': 'application/json' },
      body: JSON.stringify(launch),
    });
    await api.app(withCookie, response);
    expect(response.statusCode).toBe(403);
  });
});

describe('watching a launch', () => {
  it('lists launches without their event backlog', async () => {
    await api.post('/api/launches', launch);
    const result = await api.get('/api/launches');
    const body = result.body as { launches: { id: string; events?: unknown }[] };
    expect(body.launches).toHaveLength(1);
    expect(body.launches[0]?.events).toBeUndefined();
  });

  it('returns one launch in full, events and all', async () => {
    const started = (await api.post('/api/launches', launch)).body as { launch: { id: string } };
    await api.deps.launches.settled(started.launch.id);
    const result = await api.get(`/api/launches/${started.launch.id}`);
    expect(result.status).toBe(200);
    expect((result.body as { events: unknown[] }).events.length).toBeGreaterThan(0);
  });

  it('404s a launch this process never started', async () => {
    const result = await api.get('/api/launches/00000000-0000-4000-a000-000000000099');
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: { code: 'WEB_LAUNCH_NOT_FOUND' } });
  });

  it('streams the events, replaying what a reconnecting client missed', async () => {
    const started = (await api.post('/api/launches', launch)).body as { launch: { id: string } };
    const id = started.launch.id;
    await api.deps.launches.settled(id);
    const response = recordedResponse();
    await api.app(
      recordedRequest({
        url: `/api/launches/${id}/events`,
        headers: { cookie: `chip_session=${api.session.cookie}` },
      }),
      response,
    );
    const stream = response.chunks.join('');
    expect(stream).toContain('event: started');
    expect(stream).toContain('event: finished');
    expect(stream).toContain('event: closed');
    expect(response.writableEnded).toBe(true);
  });

  it('resumes from the last event a client saw', async () => {
    const started = (await api.post('/api/launches', launch)).body as { launch: { id: string } };
    const id = started.launch.id;
    await api.deps.launches.settled(id);
    const response = recordedResponse();
    await api.app(
      recordedRequest({
        url: `/api/launches/${id}/events`,
        headers: { cookie: `chip_session=${api.session.cookie}`, 'last-event-id': '2' },
      }),
      response,
    );
    const stream = response.chunks.join('');
    expect(stream).not.toContain('event: started');
    expect(stream).toContain('event: finished');
  });

  it('streams a launch that is still running, and closes when it ends', async () => {
    const record = api.deps.launches.create({
      kind: 'extract',
      mpns: ['TPS54331DR'],
      model: 'claude-opus-5',
      promptVersion: 'extract.v1',
      maxCostUsd: 4,
      allowSpend: false,
      actor: 'gavin',
    });
    const response = recordedResponse();
    const streaming = api.app(
      recordedRequest({
        url: `/api/launches/${record.id}/events`,
        headers: { cookie: `chip_session=${api.session.cookie}` },
      }),
      response,
    );
    await streaming;
    expect(response.writableEnded).toBe(false);
    api.deps.launches.emit(record.id, 'progress', { mpn: 'TPS54331DR' });
    api.deps.launches.emit(record.id, 'finished', { spentUsd: 0 });
    expect(response.chunks.join('')).toContain('event: progress');
    expect(response.writableEnded).toBe(true);
  });

  it('ignores a resume header that is not a number', async () => {
    const started = (await api.post('/api/launches', launch)).body as { launch: { id: string } };
    await api.deps.launches.settled(started.launch.id);
    const response = recordedResponse();
    await api.app(
      recordedRequest({
        url: `/api/launches/${started.launch.id}/events`,
        headers: { cookie: `chip_session=${api.session.cookie}`, 'last-event-id': 'nonsense' },
      }),
      response,
    );
    expect(response.chunks.join('')).toContain('event: started');
  });
});

describe('cancelling a launch', () => {
  it('marks it cancelling and says so on the stream', async () => {
    const record = api.deps.launches.create({
      kind: 'extract',
      mpns: ['TPS54331DR', 'AP62200WU-7'],
      model: 'claude-opus-5',
      promptVersion: 'extract.v1',
      maxCostUsd: 4,
      allowSpend: false,
      actor: 'gavin',
    });
    const result = await api.post(`/api/launches/${record.id}/cancel`);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ launch: { cancelling: true } });
  });

  it('refuses to cancel one that has already ended', async () => {
    const started = (await api.post('/api/launches', launch)).body as { launch: { id: string } };
    await api.deps.launches.settled(started.launch.id);
    const result = await api.post(`/api/launches/${started.launch.id}/cancel`);
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: { code: 'WEB_LAUNCH_NOT_RUNNING' } });
  });
});

describe('payload shape', () => {
  it('keeps the shape of a launch', async () => {
    const body = (await api.post('/api/launches', launch)).body as {
      launch: Record<string, unknown>;
    };
    expect(Object.keys(body.launch).sort()).toMatchSnapshot();
  });
});
