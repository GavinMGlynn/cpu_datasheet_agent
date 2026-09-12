import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createWeb, type WebOptions } from '../create.js';
import { buildSnapshot, type SnapshotOptions } from './build.js';
import { renderSnapshot } from './render.js';

export interface WrittenSnapshot {
  readonly file: string;
  readonly bytes: number;
}

/**
 * Builds a snapshot and writes it as one file.
 *
 * The whole site is wired up to do it, because the snapshot is the same read
 * models the pages use — there is no second version of the numbers to keep in
 * step with the first.
 */
export async function writeSnapshot(
  file: string,
  options: WebOptions = {},
  snapshotOptions: SnapshotOptions = {},
): Promise<WrittenSnapshot> {
  const parts = await createWeb(options);
  try {
    const snapshot = await buildSnapshot(parts.deps, snapshotOptions);
    const html = renderSnapshot(snapshot);
    await mkdir(path.dirname(path.resolve(file)), { recursive: true });
    await writeFile(file, html);
    return { file, bytes: Buffer.byteLength(html) };
  } finally {
    parts.close();
  }
}
