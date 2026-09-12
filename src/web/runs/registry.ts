import { randomUUID } from 'node:crypto';

import type { FinishedRun, RunKind } from '../../core/run.js';
import { required } from '../../util/present.js';
import { WebError } from '../server/errors.js';

/**
 * The runs this process has started, and what they are doing.
 *
 * A run takes minutes and costs dollars, so the browser needs to watch one
 * rather than wait for it. Every launch gets an entry here; every entry keeps
 * its events so a page that reloads can catch up rather than starting blind.
 */

export type LaunchState = 'running' | 'finished' | 'failed' | 'cancelled';

export interface LaunchEvent {
  /** Position in this launch's stream, from 1. A client resumes from the last it saw. */
  readonly sequence: number;
  readonly at: string;
  readonly kind: 'started' | 'part' | 'progress' | 'finished' | 'failed' | 'cancelled';
  readonly data: unknown;
}

export interface LaunchRecord {
  readonly id: string;
  readonly kind: RunKind | 'eval';
  /** The parts this launch is working through, in order. */
  readonly mpns: readonly string[];
  readonly model: string;
  readonly promptVersion: string;
  readonly maxCostUsd: number;
  readonly allowSpend: boolean;
  readonly actor: string;
  readonly startedAt: string;
  readonly state: LaunchState;
  readonly endedAt: string | undefined;
  /** Runs finished so far, newest last. */
  readonly runs: readonly FinishedRun[];
  /** What went wrong, when something did. */
  readonly error: string | undefined;
  readonly events: readonly LaunchEvent[];
  /** True once something asked this launch to stop. */
  readonly cancelling: boolean;
}

export interface LaunchDraft {
  readonly kind: RunKind | 'eval';
  readonly mpns: readonly string[];
  readonly model: string;
  readonly promptVersion: string;
  readonly maxCostUsd: number;
  readonly allowSpend: boolean;
  readonly actor: string;
}

export type LaunchListener = (event: LaunchEvent) => void;

export interface LaunchRegistry {
  create(draft: LaunchDraft): LaunchRecord;
  get(id: string): LaunchRecord | undefined;
  require(id: string): LaunchRecord;
  list(): readonly LaunchRecord[];
  /** Records an event and hands it to every listener. */
  emit(id: string, kind: LaunchEvent['kind'], data: unknown): LaunchEvent;
  addRun(id: string, run: FinishedRun): void;
  finish(id: string, state: Exclude<LaunchState, 'running'>, error?: string): LaunchRecord;
  /** Asks a launch to stop after the part it is on. */
  cancel(id: string): LaunchRecord;
  /** Whether the launch has been asked to stop, read by the loop between parts. */
  cancelling(id: string): boolean;
  /** Events after `sequence`, for a client that reconnected. */
  since(id: string, sequence: number): readonly LaunchEvent[];
  /** Subscribes to new events. Returns the function that unsubscribes. */
  subscribe(id: string, listener: LaunchListener): () => void;
  /**
   * Resolves when the launch stops running, whichever way it stopped.
   *
   * The browser watches the event stream; this is for anything that has to
   * wait — a shutdown that should not cut a run off mid-part, and a test.
   */
  settled(id: string): Promise<LaunchRecord>;
  /** Drops finished launches older than `keep`, newest kept. */
  prune(keep: number): number;
}

export interface RegistryOptions {
  readonly clock?: () => Date;
  readonly newId?: () => string;
  /** Events kept per launch. Older ones are dropped from the replay buffer. */
  readonly maxEvents?: number;
}

const DEFAULT_MAX_EVENTS = 2000;

interface Entry {
  record: LaunchRecord;
  sequence: number;
  readonly listeners: Set<LaunchListener>;
  readonly settled: Promise<LaunchRecord>;
  resolve: (record: LaunchRecord) => void;
}

export function createLaunchRegistry(options: RegistryOptions = {}): LaunchRegistry {
  const clock = options.clock ?? ((): Date => new Date());
  const newId = options.newId ?? randomUUID;
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  const entries = new Map<string, Entry>();

  const entry = (id: string): Entry => {
    const found = entries.get(id);
    if (found === undefined) {
      throw new WebError(404, 'WEB_LAUNCH_NOT_FOUND', `no launch ${id} in this process`, {
        details: { id },
      });
    }
    return found;
  };

  const update = (id: string, change: (record: LaunchRecord) => LaunchRecord): LaunchRecord => {
    const found = entry(id);
    found.record = change(found.record);
    return found.record;
  };

  return {
    create(draft) {
      const record: LaunchRecord = {
        ...draft,
        id: newId(),
        startedAt: clock().toISOString(),
        state: 'running',
        endedAt: undefined,
        runs: [],
        error: undefined,
        events: [],
        cancelling: false,
      };
      // Assigned synchronously by the executor below, which is why the
      // definite-assignment assertion is honest here.
      let resolve!: (settled: LaunchRecord) => void;
      const settled = new Promise<LaunchRecord>((done) => {
        resolve = done;
      });
      entries.set(record.id, { record, sequence: 0, listeners: new Set(), settled, resolve });
      return record;
    },

    get: (id) => entries.get(id)?.record,
    require: (id) => entry(id).record,
    list: () => [...entries.values()].map((held) => held.record),

    emit(id, kind, data) {
      const found = entry(id);
      found.sequence += 1;
      const event: LaunchEvent = {
        sequence: found.sequence,
        at: clock().toISOString(),
        kind,
        data,
      };
      const events = [...found.record.events, event];
      found.record = {
        ...found.record,
        events: events.length > maxEvents ? events.slice(events.length - maxEvents) : events,
      };
      for (const listener of found.listeners) {
        listener(event);
      }
      return event;
    },

    addRun(id, run) {
      update(id, (record) => ({ ...record, runs: [...record.runs, run] }));
    },

    finish(id, state, error) {
      const record = update(id, (held) => ({
        ...held,
        state,
        endedAt: clock().toISOString(),
        error,
      }));
      entry(id).resolve(record);
      return record;
    },

    settled: (id) => entry(id).settled,

    cancel(id) {
      const record = entry(id).record;
      if (record.state !== 'running') {
        throw new WebError(
          409,
          'WEB_LAUNCH_NOT_RUNNING',
          `launch ${id} is already ${record.state}`,
          {
            details: { id, state: record.state },
          },
        );
      }
      return update(id, (held) => ({ ...held, cancelling: true }));
    },

    cancelling: (id) => entry(id).record.cancelling,

    since(id, sequence) {
      return entry(id).record.events.filter((event) => event.sequence > sequence);
    },

    subscribe(id, listener) {
      const found = entry(id);
      found.listeners.add(listener);
      return () => {
        found.listeners.delete(listener);
      };
    },

    prune(keep) {
      // A launch that is not running has ended, and `finish` is the only way
      // to stop running, so the end time is there to sort by.
      const endedAt = (held: Entry): string =>
        required(held.record.endedAt, 'the end time of a finished launch');
      const finished = [...entries.values()]
        .filter((held) => held.record.state !== 'running')
        .sort((a, b) => endedAt(a).localeCompare(endedAt(b)));
      const drop = finished.slice(0, Math.max(0, finished.length - keep));
      for (const held of drop) {
        entries.delete(held.record.id);
      }
      return drop.length;
    },
  };
}
