import type { RouteEntry } from '../server/app.js';
import type { Router } from '../server/router.js';
import { registerAlternates } from './alternates.js';
import { registerCache } from './cache.js';
import { registerDatasheets } from './datasheets.js';
import { registerEvals } from './evals.js';
import { registerHealth } from './health.js';
import { registerLaunches } from './launches.js';
import { registerParts } from './parts.js';
import { registerRuns } from './runs.js';
import { registerStats } from './stats.js';
import { registerWrites } from './writes.js';
import type { ApiDeps } from './deps.js';

export * from './alternates.js';
export * from './cache.js';
export * from './datasheets.js';
export * from './deps.js';
export * from './evals.js';
export * from './health.js';
export * from './launches.js';
export * from './params.js';
export * from './parts.js';
export * from './runs.js';
export * from './stats.js';
export * from './writes.js';

/**
 * Registers every read endpoint.
 *
 * Order matters where a literal shares a prefix with a parameter — the
 * evaluation comparison before the single result, for instance — and each
 * module keeps its own order internally. Across modules there is no overlap.
 */
export function registerApi(router: Router<RouteEntry>, deps: ApiDeps): void {
  registerHealth(router, deps);
  registerParts(router, deps);
  registerDatasheets(router, deps);
  registerAlternates(router, deps);
  registerRuns(router, deps);
  registerStats(router, deps);
  registerEvals(router, deps);
  registerCache(router, deps);
  registerWrites(router, deps);
  registerLaunches(router, deps);
}
