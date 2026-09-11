import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PromptVersion, parseOrThrow } from '../core/index.js';
import { ChipAgentError } from '../errors.js';

export class PromptError extends ChipAgentError {}

/** The directory holding the versioned prompt files. */
export const PROMPT_DIR = fileURLToPath(new URL('../../prompts/', import.meta.url));

export interface Prompt {
  readonly version: string;
  /** The file's words, with trailing whitespace removed. */
  readonly text: string;
  /** Digest of those exact words, recorded with the run. */
  readonly sha256: string;
}

/**
 * Loads a versioned prompt file from a given directory.
 *
 * Prompt text is versioned rather than edited: `extract.v1.md` is a fixed
 * set of words, and changing them means writing `extract.v2.md`. The digest
 * goes into the run's ledger entry so a stored run names not just which
 * prompt it was given but that it was this one.
 *
 * Throws `PROMPT_NOT_FOUND` when there is no such file and `PROMPT_EMPTY`
 * when the file holds nothing.
 */
export async function loadPromptFrom(dir: string, version: string): Promise<Prompt> {
  const parsed = parseOrThrow(PromptVersion, version, 'prompt version');
  const file = path.join(dir, `${parsed}.md`);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    throw new PromptError('PROMPT_NOT_FOUND', `no prompt file for version ${parsed}`, {
      cause: error,
      details: { version: parsed, file },
    });
  }
  const trimmed = text.trimEnd();
  if (trimmed === '') {
    throw new PromptError('PROMPT_EMPTY', `prompt file for version ${parsed} is empty`, {
      details: { version: parsed, file },
    });
  }
  return {
    version: parsed,
    text: trimmed,
    sha256: createHash('sha256').update(trimmed).digest('hex'),
  };
}

/** Loads a versioned prompt from this project's `prompts/` directory. */
export function loadPrompt(version: string): Promise<Prompt> {
  return loadPromptFrom(PROMPT_DIR, version);
}

/** The one instruction a run is given: which part it is about. */
export function extractionRequest(mpn: string): string {
  return `Extract the parameters of ${mpn} from its datasheet and store the part.`;
}
