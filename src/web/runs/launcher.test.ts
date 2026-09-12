import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import {
  assistantText,
  failingQuery,
  resultMessage,
  scriptedQuery,
} from '../../../test/helpers/agent-sdk.js';
import { capturedLogger } from '../../../test/helpers/web.js';
import { loadConfig } from '../../config.js';
import { parseOrThrow } from '../../core/validation-error.js';
import { createRepositories, openDatabase } from '../../db/index.js';
import { part as partFixture } from '../../../test/helpers/core-fixtures.js';
import { LaunchRequest, createLauncher } from './launcher.js';
import { createLaunchRegistry, type LaunchRegistry } from './registry.js';

let root: string;
let registry: LaunchRegistry;

const MESSAGES: readonly SDKMessage[] = [
  assistantText('reading the ordering table'),
  resultMessage({ numTurns: 7, costUsd: 0.31, text: 'nothing stored' }),
];

function request(overrides: Record<string, unknown> = {}): LaunchRequest {
  return parseOrThrow(
    LaunchRequest,
    {
      kind: 'extract',
      mpns: ['TPS54331DR'],
      actor: 'gavin',
      reason: 'checking the runner works',
      ceilingUsd: 10,
      confirmed: true,
      ...overrides,
    },
    'LaunchRequest',
  );
}

function launcher(query: ReturnType<typeof scriptedQuery>['query']) {
  return createLauncher({
    config: loadConfig({ DATA_DIR: path.join(root, 'data'), LOG_LEVEL: 'error' }),
    registry,
    logger: capturedLogger().logger,
    query,
    databasePath: path.join(root, 'data', 'chip.sqlite'),
  });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'chip-web-launch-'));
  let ids = 0;
  registry = createLaunchRegistry({ newId: () => `launch-${String((ids += 1))}` });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('LaunchRequest', () => {
  it('refuses a launch that was never confirmed', () => {
    expect(LaunchRequest.safeParse({ ...request(), confirmed: false }).success).toBe(false);
    const { confirmed: _confirmed, ...unconfirmed } = request();
    expect(LaunchRequest.safeParse(unconfirmed).success).toBe(false);
  });

  it('refuses one with no ceiling, no reason, or no parts', () => {
    const { ceilingUsd: _ceiling, ...noCeiling } = request();
    expect(LaunchRequest.safeParse(noCeiling).success).toBe(false);
    expect(LaunchRequest.safeParse({ ...request(), reason: '' }).success).toBe(false);
    expect(LaunchRequest.safeParse({ ...request(), mpns: [] }).success).toBe(false);
  });

  it('defaults to spending nothing', () => {
    expect(request().allowSpend).toBe(false);
  });
});

describe('starting a run', () => {
  it('runs each part and records what it cost', async () => {
    const { query, calls } = scriptedQuery(MESSAGES);
    const { id, promise } = launcher(query).start(request({ mpns: ['TPS54331DR', 'AP62200WU-7'] }));
    await promise;
    const launch = registry.require(id);
    expect(launch.state).toBe('finished');
    expect(launch.runs).toHaveLength(2);
    expect(calls).toHaveLength(2);
    const parts = launch.events.filter((event) => event.kind === 'part');
    expect(parts).toHaveLength(2);
    expect(parts[1]?.data).toMatchObject({ spentUsd: 0.62 });
  });

  it('tells the stream what it is about to do before it does it', async () => {
    const { query } = scriptedQuery(MESSAGES);
    const { id, promise } = launcher(query).start(request());
    await promise;
    const kinds = registry.require(id).events.map((event) => event.kind);
    expect(kinds).toStrictEqual(['started', 'progress', 'part', 'finished']);
    expect(registry.require(id).events[0]?.data).toMatchObject({
      parts: 1,
      allowSpend: false,
      model: expect.any(String) as unknown,
    });
  });

  it('carries the model, prompt and ceiling the caller chose', async () => {
    const { query, calls } = scriptedQuery(MESSAGES);
    const { id, promise } = launcher(query).start(
      request({ model: 'claude-haiku-4-5', effort: 'low', maxTurns: 5, maxCostUsd: 1 }),
    );
    await promise;
    expect(registry.require(id).model).toBe('claude-haiku-4-5');
    expect(calls[0]?.options).toMatchObject({
      model: 'claude-haiku-4-5',
      effort: 'low',
      maxTurns: 5,
      maxBudgetUsd: 1,
    });
  });

  it('verifies a stored part, reading the verification prompt', async () => {
    const databasePath = path.join(root, 'data', 'chip.sqlite');
    const db = openDatabase(databasePath);
    createRepositories(db).parts.upsertPart(partFixture());
    db.close();
    const { query } = scriptedQuery(MESSAGES);
    const { id, promise } = launcher(query).start(request({ kind: 'verify' }));
    await promise;
    const launch = registry.require(id);
    expect(launch.promptVersion).toBe('verify.v1');
    expect(launch.state).toBe('finished');
    expect(launch.runs[0]?.kind).toBe('verify');
  });

  it('finds its own database and the real harness when it is given neither', async () => {
    const config = loadConfig({ DATA_DIR: path.join(root, 'data'), LOG_LEVEL: 'error' });
    const logger = capturedLogger().logger;
    // No harness given: it holds the real one, and nothing is called until a
    // run starts.
    expect(typeof createLauncher({ config, registry, logger }).start).toBe('function');
    // No database given: the run writes to the data directory's own store.
    const { query } = scriptedQuery(MESSAGES);
    const { id, promise } = createLauncher({ config, registry, logger, query }).start(request());
    await promise;
    expect(registry.require(id).state).toBe('finished');
  });
});

describe('the ceiling', () => {
  it('stops starting parts once the launch has spent what it was given', async () => {
    const { query, calls } = scriptedQuery(MESSAGES);
    const { id, promise } = launcher(query).start(
      request({ mpns: ['TPS54331DR', 'AP62200WU-7', 'LM5164DDAR'], ceilingUsd: 0.5 }),
    );
    await promise;
    const launch = registry.require(id);
    expect(calls).toHaveLength(2);
    expect(launch.runs).toHaveLength(2);
    expect(launch.state).toBe('finished');
    expect(launch.events.at(-1)?.data).toMatchObject({ reason: 'ceiling reached', ran: 2 });
  });
});

describe('cancellation', () => {
  it('stops between parts when it is asked to', async () => {
    const { query, calls } = scriptedQuery(MESSAGES, async () => {
      registry.cancel('launch-1');
      await Promise.resolve();
    });
    const { id, promise } = launcher(query).start(request({ mpns: ['TPS54331DR', 'AP62200WU-7'] }));
    await promise;
    const launch = registry.require(id);
    expect(calls).toHaveLength(1);
    expect(launch.state).toBe('cancelled');
    expect(launch.events.at(-1)).toMatchObject({ kind: 'cancelled' });
  });
});

describe('failure', () => {
  it('treats a harness that died as a run that ended, not as a launch that broke', async () => {
    // `executeRun` records a crashed harness as a rejected run rather than
    // throwing: the launch is still a launch that happened.
    const { query } = failingQuery(new Error('the harness died'));
    const { id, promise } = launcher(query).start(request());
    await promise;
    const launch = registry.require(id);
    expect(launch.state).toBe('finished');
    expect(launch.runs[0]?.result).toBe('rejected');
  });

  it('fails the launch when the run cannot even be set up', async () => {
    const { query } = scriptedQuery(MESSAGES);
    const { id, promise } = launcher(query).start(request({ promptVersion: 'extract.v99' }));
    await promise;
    expect(registry.require(id)).toMatchObject({ state: 'failed' });
  });
});
