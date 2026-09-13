import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { parseOrThrow } from './core/validation-error.js';

/**
 * What this build calls itself.
 *
 * One source of truth. The version in `package.json` is what the release tag
 * names, what the packaged archive is called, and what the site prints under
 * its own name in the sidebar; a second copy in the source is a second copy
 * to forget.
 *
 * The path is relative to this module, so it resolves from `src/` when run
 * through tsx and from `dist/` in a packaged installation — `package.json`
 * travels beside `dist/` in the archive for exactly this reason.
 */

const Manifest = z.object({ version: z.string().min(1) });

/** Reads the version out of a package manifest, or says why it cannot. */
export function versionIn(manifest: URL | string): string {
  const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
  return parseOrThrow(Manifest, parsed, 'the package manifest').version;
}

export const VERSION = versionIn(new URL('../package.json', import.meta.url));
