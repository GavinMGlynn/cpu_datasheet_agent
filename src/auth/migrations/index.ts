import type { Migration } from '../../db/migrate.js';
import { migration as accounts } from './0001-accounts.js';

/** Every migration of the identity store, in order. Append only. */
export const AUTH_MIGRATIONS: readonly Migration[] = Object.freeze([accounts]);
