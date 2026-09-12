import type { Migration } from '../../db/migrate.js';
import { migration as accounts } from './0001-accounts.js';
import { migration as oidcFlows } from './0002-oidc-flows.js';

/** Every migration of the identity store, in order. Append only. */
export const AUTH_MIGRATIONS: readonly Migration[] = Object.freeze([accounts, oidcFlows]);
