import type { Migration } from '../migrate.js';

/**
 * `RunDetails` gained `cacheMisses` when the evaluation harness needed to
 * read it back: a score for a part whose datasheet was not on disk measures
 * the cache rather than the prompt, and a resumed evaluation reads that off
 * the stored run rather than recomputing it.
 *
 * Runs recorded before the field existed did not count it, and zero is what
 * they would have counted: the detail is a count of calls that asked for
 * something uncached, and a run that never reported one made none of them.
 */
export const migration: Migration = {
  id: 3,
  name: 'run-cache-misses',
  up: `
UPDATE runs
SET details_json = json_set(details_json, '$.cacheMisses', 0)
WHERE details_json IS NOT NULL
  AND json_extract(details_json, '$.cacheMisses') IS NULL;
`,
};
