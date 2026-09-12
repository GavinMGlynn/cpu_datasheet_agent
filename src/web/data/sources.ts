import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { createRepositories, openDatabase, type Repositories } from '../../db/index.js';
import type { Db } from '../../db/database.js';
import { WebError } from '../server/errors.js';

/** The identifier the live store answers to. Every other source is a file name. */
export const LIVE_SOURCE = 'live';

export type SourceKind = 'live' | 'eval-run';

export interface DataSource {
  readonly id: string;
  readonly kind: SourceKind;
  readonly file: string;
  readonly label: string;
  /** False when the file is not there yet, which is true of a fresh checkout. */
  readonly exists: boolean;
  readonly bytes: number;
  readonly modifiedAt: string | undefined;
  /**
   * Whether this source may be written to. Only the live store may: an
   * evaluation database is the evidence behind a published number, and
   * editing it would rewrite the baseline rather than record a correction.
   */
  readonly writable: boolean;
}

export interface SourcesOptions {
  /** The live store. Defaults to the project's `data/chip.sqlite`. */
  readonly databaseFile?: string;
  /** Where the evaluation harness leaves a database per run. */
  readonly evalRunsDir?: string;
}

export const DEFAULT_DATABASE_FILE = 'data/chip.sqlite';
export const DEFAULT_EVAL_RUNS_DIR = 'data/eval-runs';

export interface OpenSource {
  readonly source: DataSource;
  readonly db: Db;
  readonly repositories: Repositories;
}

export interface Sources {
  /** Every database this installation can read, live store first. */
  list(): Promise<readonly DataSource[]>;
  /** Opens one by id, keeping the connection for later requests. */
  open(id: string): Promise<OpenSource>;
  /** Throws unless the source may be written to. */
  requireWritable(id: string): Promise<OpenSource>;
  close(): void;
}

const SQLITE_SUFFIX = '.sqlite';

async function describe(
  file: string,
  id: string,
  kind: SourceKind,
  label: string,
): Promise<DataSource> {
  const writable = kind === 'live';
  try {
    const stats = await stat(file);
    return {
      id,
      kind,
      file,
      label,
      exists: true,
      bytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      writable,
    };
  } catch {
    return { id, kind, file, label, exists: false, bytes: 0, modifiedAt: undefined, writable };
  }
}

/**
 * The databases the site can read.
 *
 * There is more than one because the twenty-two parts the baseline extracted
 * live in an evaluation-run database, not in the live store, which holds two
 * (D69). A site that could read only the live store would show almost none of
 * the work this project has done.
 */
export function createSources(options: SourcesOptions = {}): Sources {
  const databaseFile = options.databaseFile ?? DEFAULT_DATABASE_FILE;
  const evalRunsDir = options.evalRunsDir ?? DEFAULT_EVAL_RUNS_DIR;
  const open = new Map<string, OpenSource>();

  const find = async (id: string): Promise<DataSource> => {
    const sources = await sources_();
    const found = sources.find((source) => source.id === id);
    if (found === undefined) {
      throw new WebError(404, 'WEB_SOURCE_NOT_FOUND', `no database is known as ${id}`, {
        details: { id },
      });
    }
    return found;
  };

  const sources_ = async (): Promise<readonly DataSource[]> => {
    const live = await describe(databaseFile, LIVE_SOURCE, 'live', 'Live store');
    let names: string[];
    try {
      names = await readdir(evalRunsDir);
    } catch {
      return [live];
    }
    const runs = await Promise.all(
      names
        .filter((name) => name.endsWith(SQLITE_SUFFIX))
        .sort()
        .map((name) => {
          const id = name.slice(0, -SQLITE_SUFFIX.length);
          return describe(path.join(evalRunsDir, name), id, 'eval-run', `Evaluation run ${id}`);
        }),
    );
    return [live, ...runs];
  };

  return {
    list: sources_,

    async open(id) {
      const already = open.get(id);
      if (already !== undefined) {
        return already;
      }
      const source = await find(id);
      const db = openDatabase(source.file);
      const opened = { source, db, repositories: createRepositories(db) };
      open.set(id, opened);
      return opened;
    },

    async requireWritable(id) {
      const opened = await this.open(id);
      if (!opened.source.writable) {
        throw new WebError(
          403,
          'WEB_SOURCE_READ_ONLY',
          `${id} is an evaluation database and is evidence, not a working copy`,
          { details: { id } },
        );
      }
      return opened;
    },

    close() {
      for (const opened of open.values()) {
        opened.db.close();
      }
      open.clear();
    },
  };
}
