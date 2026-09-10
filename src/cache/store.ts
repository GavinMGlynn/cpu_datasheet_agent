import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { Iso8601, Sha256, Url } from '../core/primitives.js';
import { CacheError, assertNamespace, type CacheRef } from './key.js';

/** Sidecar metadata stored beside every cached entry. */
export const CacheMeta = z.strictObject({
  createdAt: Iso8601,
  ttlSeconds: z.number().int().min(0).optional(),
  contentType: z.string().trim().min(1),
  sourceUrl: Url.optional(),
  size: z.number().int().min(0),
  /** Hex SHA-256 of the stored bytes. */
  sha256: Sha256,
});
export type CacheMeta = z.output<typeof CacheMeta>;

export interface CacheEntry {
  readonly bytes: Buffer;
  readonly meta: CacheMeta;
}

/**
 * Persistence behind the cache. Implementations must be safe under
 * concurrent readers and writers and must treat a missing, corrupt, or
 * mismatched entry as absent rather than throwing.
 */
export interface CacheStore {
  get(ref: CacheRef): Promise<CacheEntry | undefined>;
  put(ref: CacheRef, bytes: Buffer, meta: CacheMeta): Promise<void>;
  has(ref: CacheRef): Promise<boolean>;
  delete(ref: CacheRef): Promise<boolean>;
  stat(ref: CacheRef): Promise<CacheMeta | undefined>;
}

export function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

async function removeQuietly(target: string): Promise<void> {
  try {
    await rm(target, { force: true });
  } catch {
    // Best-effort cleanup of a temporary file; the original failure is what the caller sees.
  }
}

function ioError(message: string, error: unknown, details: Record<string, unknown>): CacheError {
  return new CacheError('CACHE_IO', message, { cause: error, details });
}

/**
 * Directory-sharded file store: `root/<namespace>/ab/cd/<hash>` holds the
 * bytes and `<hash>.meta.json` the sidecar. Writes go to a temporary file in
 * the same directory and are renamed into place, so a reader never sees a
 * partial entry. A missing or invalid sidecar, or bytes whose size or digest
 * disagree with it, count as a miss and the entry is removed.
 */
export class FileCacheStore implements CacheStore {
  constructor(readonly root: string) {}

  dataPath(ref: CacheRef): string {
    assertNamespace(ref.namespace);
    return path.join(
      this.root,
      ref.namespace,
      ref.hash.slice(0, 2),
      ref.hash.slice(2, 4),
      ref.hash,
    );
  }

  metaPath(ref: CacheRef): string {
    return `${this.dataPath(ref)}.meta.json`;
  }

  async stat(ref: CacheRef): Promise<CacheMeta | undefined> {
    const metaPath = this.metaPath(ref);
    let text: string;
    try {
      text = await readFile(metaPath, 'utf8');
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw ioError(`cannot read cache metadata ${metaPath}`, error, { path: metaPath });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      await this.delete(ref);
      return undefined;
    }
    const result = CacheMeta.safeParse(parsed);
    if (!result.success) {
      await this.delete(ref);
      return undefined;
    }
    return result.data;
  }

  async has(ref: CacheRef): Promise<boolean> {
    return (await this.stat(ref)) !== undefined;
  }

  async get(ref: CacheRef): Promise<CacheEntry | undefined> {
    const meta = await this.stat(ref);
    if (meta === undefined) {
      return undefined;
    }
    const dataPath = this.dataPath(ref);
    let bytes: Buffer;
    try {
      bytes = await readFile(dataPath);
    } catch (error) {
      if (isNotFound(error)) {
        await this.delete(ref);
        return undefined;
      }
      throw ioError(`cannot read cache entry ${dataPath}`, error, { path: dataPath });
    }
    if (bytes.length !== meta.size || sha256Of(bytes) !== meta.sha256) {
      await this.delete(ref);
      return undefined;
    }
    return { bytes, meta };
  }

  async put(ref: CacheRef, bytes: Buffer, meta: CacheMeta): Promise<void> {
    const dataPath = this.dataPath(ref);
    const metaPath = this.metaPath(ref);
    const dir = path.dirname(dataPath);
    const suffix = `.tmp-${randomBytes(6).toString('hex')}`;
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(`${dataPath}${suffix}`, bytes);
      await writeFile(`${metaPath}${suffix}`, JSON.stringify(meta), 'utf8');
      await rename(`${dataPath}${suffix}`, dataPath);
      await rename(`${metaPath}${suffix}`, metaPath);
    } catch (error) {
      await removeQuietly(`${dataPath}${suffix}`);
      await removeQuietly(`${metaPath}${suffix}`);
      throw ioError(`cannot write cache entry ${dataPath}`, error, { path: dataPath });
    }
  }

  async delete(ref: CacheRef): Promise<boolean> {
    const dataPath = this.dataPath(ref);
    const metaPath = this.metaPath(ref);
    let removed = false;
    for (const target of [dataPath, metaPath]) {
      try {
        await rm(target);
        removed = true;
      } catch (error) {
        if (!isNotFound(error)) {
          throw ioError(`cannot delete cache entry ${target}`, error, { path: target });
        }
      }
    }
    return removed;
  }
}
