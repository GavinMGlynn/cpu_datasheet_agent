import type { Migration } from '../migrate.js';
import { migration as initial } from './0001-initial.js';

/** Every migration, in order. Append only; never edit an applied migration. */
export const MIGRATIONS: readonly Migration[] = Object.freeze([initial]);
