import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { parseOrThrow } from '../core/index.js';
import { GoldenPart } from './golden.js';

/** Where the hand-characterised parts live, relative to the repository root. */
export const GOLDEN_DIR = 'eval/golden';

export interface LoadedGolden {
  /** File name, so a failure names the file a reader can open. */
  readonly file: string;
  readonly part: GoldenPart;
}

/**
 * Loads every golden part, validating each against the schema.
 *
 * A file that fails validation throws rather than being skipped: a golden set
 * with an unreadable member measures the wrong thing quietly.
 */
export function loadGoldenSet(dir = GOLDEN_DIR): readonly LoadedGolden[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => ({
      file,
      part: parseOrThrow(
        GoldenPart,
        JSON.parse(readFileSync(path.join(dir, file), 'utf8')),
        `golden part ${file}`,
      ),
    }));
}
