import { describe, expect, it } from 'vitest';

import { finishedRun } from '../../../test/helpers/core-fixtures.js';
import { Run, type FinishedRun } from '../../core/run.js';
import { parseOrThrow } from '../../core/validation-error.js';
import { createLaunchRegistry, type LaunchEvent, type LaunchRegistry } from './registry.js';

const draft = {
  kind: 'extract' as const,
  mpns: ['TPS54331DR', 'AP62200WU-7'],
  model: 'claude-opus-5',
  promptVersion: 'extract.v1',
  maxCostUsd: 4,
  allowSpend: false,
  actor: 'gavin',
};

function registry(): LaunchRegistry {
  let ids = 0;
  let ticks = 0;
  return createLaunchRegistry({
    newId: () => `launch-${String((ids += 1))}`,
    clock: () => new Date(Date.parse('2026-09-12T00:00:00Z') + (ticks += 1000)),
  });
}

function run(overrides: Record<string, unknown> = {}): FinishedRun {
  return parseOrThrow(Run, finishedRun(overrides), 'Run') as FinishedRun;
}

describe('create and read', () => {
  it('records a launch as running, with nothing done yet', () => {
    const registered = registry();
    const launch = registered.create(draft);
    expect(launch).toMatchObject({
      id: 'launch-1',
      state: 'running',
      runs: [],
      events: [],
      cancelling: false,
      endedAt: undefined,
    });
    expect(registered.get('launch-1')).toStrictEqual(launch);
    expect(registered.list()).toHaveLength(1);
  });

  it('says plainly when a launch is not one this process started', () => {
    const registered = registry();
    expect(registered.get('nothing')).toBeUndefined();
    expect(() => registered.require('nothing')).toThrow(
      expect.objectContaining({ code: 'WEB_LAUNCH_NOT_FOUND', status: 404 }),
    );
  });
});

describe('defaults', () => {
  it('stamps a real id and a real time when it is given neither', () => {
    const plain = createLaunchRegistry();
    const launch = plain.create(draft);
    expect(launch.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(Date.parse(launch.startedAt)).toBeGreaterThan(0);
    plain.emit(launch.id, 'started', {});
    expect(plain.require(launch.id).events).toHaveLength(1);
  });
});

describe('events', () => {
  it('numbers them and hands them to listeners', () => {
    const registered = registry();
    registered.create(draft);
    const seen: LaunchEvent[] = [];
    const unsubscribe = registered.subscribe('launch-1', (event) => seen.push(event));
    registered.emit('launch-1', 'started', { parts: 2 });
    registered.emit('launch-1', 'progress', { mpn: 'TPS54331DR' });
    expect(seen.map((event) => event.sequence)).toStrictEqual([1, 2]);
    unsubscribe();
    registered.emit('launch-1', 'finished', {});
    expect(seen).toHaveLength(2);
    expect(registered.require('launch-1').events).toHaveLength(3);
  });

  it('replays what a reconnecting client missed', () => {
    const registered = registry();
    registered.create(draft);
    registered.emit('launch-1', 'started', {});
    registered.emit('launch-1', 'progress', {});
    registered.emit('launch-1', 'part', {});
    expect(registered.since('launch-1', 1).map((event) => event.kind)).toStrictEqual([
      'progress',
      'part',
    ]);
    expect(registered.since('launch-1', 0)).toHaveLength(3);
    expect(registered.since('launch-1', 9)).toStrictEqual([]);
  });

  it('keeps only the most recent events, so a long run cannot grow without bound', () => {
    const small = createLaunchRegistry({ newId: () => 'launch-1', maxEvents: 3 });
    small.create(draft);
    for (let index = 0; index < 5; index += 1) {
      small.emit('launch-1', 'progress', { index });
    }
    const events = small.require('launch-1').events;
    expect(events).toHaveLength(3);
    expect(events[0]?.sequence).toBe(3);
  });
});

describe('progress and ending', () => {
  it('collects the runs as they finish', () => {
    const registered = registry();
    registered.create(draft);
    registered.addRun('launch-1', run({ mpn: 'TPS54331DR' }));
    registered.addRun('launch-1', run({ mpn: 'AP62200WU-7' }));
    expect(registered.require('launch-1').runs.map((one) => one.mpn)).toStrictEqual([
      'TPS54331DR',
      'AP62200WU-7',
    ]);
  });

  it('ends a launch, keeping why when it failed', () => {
    const registered = registry();
    registered.create(draft);
    const finished = registered.finish('launch-1', 'failed', 'the harness died');
    expect(finished).toMatchObject({ state: 'failed', error: 'the harness died' });
    expect(finished.endedAt).not.toBeUndefined();
  });
});

describe('cancellation', () => {
  it('marks a running launch as cancelling, which the loop reads between parts', () => {
    const registered = registry();
    registered.create(draft);
    expect(registered.cancelling('launch-1')).toBe(false);
    expect(registered.cancel('launch-1').cancelling).toBe(true);
    expect(registered.cancelling('launch-1')).toBe(true);
  });

  it('refuses to cancel one that has already ended', () => {
    const registered = registry();
    registered.create(draft);
    registered.finish('launch-1', 'finished');
    expect(() => registered.cancel('launch-1')).toThrow(
      expect.objectContaining({ code: 'WEB_LAUNCH_NOT_RUNNING', status: 409 }),
    );
  });
});

describe('settled', () => {
  it('resolves when the launch stops running, whichever way it stopped', async () => {
    const registered = registry();
    registered.create(draft);
    const waited = registered.settled('launch-1');
    registered.finish('launch-1', 'cancelled');
    await expect(waited).resolves.toMatchObject({ state: 'cancelled' });
  });
});

describe('prune', () => {
  it('drops the oldest finished launches and keeps the running ones', () => {
    const registered = registry();
    registered.create(draft);
    registered.create(draft);
    registered.create(draft);
    registered.finish('launch-1', 'finished');
    registered.finish('launch-2', 'finished');
    expect(registered.prune(1)).toBe(1);
    expect(registered.list().map((launch) => launch.id)).toStrictEqual(['launch-2', 'launch-3']);
    expect(registered.prune(10)).toBe(0);
  });
});
