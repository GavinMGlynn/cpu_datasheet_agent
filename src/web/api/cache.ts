import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { required } from '../../util/present.js';
import { summarise } from '../data/aggregate.js';
import type { RouteEntry } from '../server/app.js';
import { WebError } from '../server/errors.js';
import type { Router } from '../server/router.js';
import { read, type ApiDeps } from './deps.js';
import { PaginationShape, paginate, parseQuery } from './params.js';

/**
 * What the cache holds.
 *
 * Every network call and every rendered page is on disk under a namespace, so
 * this is the measure of what the project has actually fetched — and of what
 * it would have to fetch again. The entries are read from the file system
 * rather than an index, because the file system is the index.
 */

export interface NamespaceStats {
  readonly namespace: string;
  readonly entries: number;
  readonly bytes: number;
  readonly oldest: string | undefined;
  readonly newest: string | undefined;
}

interface EntryFile {
  readonly file: string;
  readonly hash: string;
  readonly bytes: number;
  readonly modifiedAt: string;
}

const META_SUFFIX = '.meta.json';

/**
 * Walks one namespace's two-level shard directories.
 *
 * Exported because a directory can vanish under it — a cache cleared while
 * the page is open — and that path is worth a test of its own.
 */
export async function entriesOf(root: string, namespace: string): Promise<EntryFile[]> {
  const entries: EntryFile[] = [];
  const base = path.join(root, namespace);
  let firstLevel: string[];
  try {
    firstLevel = await readdir(base);
  } catch {
    return entries;
  }
  for (const first of firstLevel) {
    let secondLevel: string[];
    try {
      secondLevel = await readdir(path.join(base, first));
    } catch {
      continue;
    }
    for (const second of secondLevel) {
      const dir = path.join(base, first, second);
      let files: string[];
      try {
        files = await readdir(dir);
      } catch {
        continue;
      }
      for (const file of files) {
        if (file.endsWith(META_SUFFIX)) {
          continue;
        }
        const stats = await stat(path.join(dir, file));
        entries.push({
          file: path.join(namespace, first, second, file),
          hash: file,
          bytes: stats.size,
          modifiedAt: stats.mtime.toISOString(),
        });
      }
    }
  }
  return entries;
}

/** The namespace directories under the cache root, sorted. */
export async function namespacesOf(root: string): Promise<string[]> {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export function registerCache(router: Router<RouteEntry>, deps: ApiDeps): void {
  router.get(
    '/api/cache',
    read(async (context) => {
      const found = await namespacesOf(deps.cacheDir);
      const stats: NamespaceStats[] = [];
      for (const namespace of found) {
        const entries = await entriesOf(deps.cacheDir, namespace);
        const times = entries.map((entry) => entry.modifiedAt).sort();
        stats.push({
          namespace,
          entries: entries.length,
          bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
          oldest: times[0],
          newest: times[times.length - 1],
        });
      }
      context.respond.json(context.response, context.facts, {
        root: deps.cacheDir,
        namespaces: stats,
        totals: {
          namespaces: stats.length,
          entries: stats.reduce((total, one) => total + one.entries, 0),
          bytes: stats.reduce((total, one) => total + one.bytes, 0),
        },
      });
    }),
  );

  const EntriesQuery = z.strictObject({ ...PaginationShape });

  router.get(
    '/api/cache/:namespace',
    read(async (context) => {
      const query = parseQuery(EntriesQuery, context.query);
      const namespace = required(context.params.namespace, 'a namespace in the path');
      if (!(await namespacesOf(deps.cacheDir)).includes(namespace)) {
        throw new WebError(
          404,
          'WEB_CACHE_NAMESPACE_NOT_FOUND',
          `nothing cached for ${namespace}`,
          {
            details: { namespace },
          },
        );
      }
      const entries = await entriesOf(deps.cacheDir, namespace);
      entries.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
      context.respond.json(context.response, context.facts, {
        namespace,
        sizes: summarise(entries.map((entry) => entry.bytes)),
        ...paginate(entries, query.offset, query.limit),
      });
    }),
  );
}
