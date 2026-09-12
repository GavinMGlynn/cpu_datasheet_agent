import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { seed } from './seed.js';

/**
 * Builds the data the browser tests read, before the server opens it.
 *
 * This runs as the first half of Playwright's `webServer` command rather than
 * as a global setup: a global setup is not guaranteed to finish before the
 * server starts, and when it does not, the server opens an empty database,
 * the seeding deletes the directory underneath it, and every test meets a
 * site that says it has no accounts. Sequencing it here removes the question.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
await seed(path.join(here, '.data'));
process.stdout.write("seeded the browser tests' data directory\n");
