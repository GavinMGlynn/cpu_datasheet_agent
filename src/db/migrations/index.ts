import type { Migration } from '../migrate.js';
import { migration as initial } from './0001-initial.js';
import { migration as parameterConflicts } from './0002-parameter-conflicts.js';
import { migration as runCacheMisses } from './0003-run-cache-misses.js';

/** Every migration, in order. Append only; never edit an applied migration. */
export const MIGRATIONS: readonly Migration[] = Object.freeze([
  initial,
  parameterConflicts,
  runCacheMisses,
]);
