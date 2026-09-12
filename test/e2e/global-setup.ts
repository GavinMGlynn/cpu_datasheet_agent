import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { seed } from './seed.js';

/**
 * Seeds the data the browser tests read, before the server starts.
 *
 * Playwright's `webServer` points at the same directory, so the browser talks
 * to a real server over a real database — one built fresh every run.
 */
export default async function globalSetup(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  await seed(path.join(here, '.data'));
}
