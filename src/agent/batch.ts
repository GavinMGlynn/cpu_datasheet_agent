import { readFile } from 'node:fs/promises';

import type { FinishedRun } from '../core/index.js';
import { normaliseMpn } from '../mpn/index.js';
import { elementAt } from '../util/array.js';
import type { RunConfig } from './config.js';
import { AgentError } from './errors.js';
import { extractPart, type RunnerDeps } from './runner.js';

/**
 * Part numbers from a file: one per line, `#` starting a comment.
 *
 * Every line is normalised here rather than when its turn comes, so a
 * malformed part number is a refusal before the first run rather than a
 * failure forty runs in.
 */
export async function readMpnList(file: string): Promise<string[]> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    throw new AgentError('BATCH_FILE_UNREADABLE', `cannot read part number list ${file}`, {
      cause: error,
      details: { file },
    });
  }
  const mpns: string[] = [];
  text.split('\n').forEach((line, index) => {
    const entry = elementAt(line.split('#'), 0).trim();
    if (entry === '') {
      return;
    }
    try {
      mpns.push(normaliseMpn(entry).mpn);
    } catch (error) {
      throw new AgentError(
        'BATCH_FILE_INVALID',
        `line ${String(index + 1)} of ${file} is not a part number: ${entry}`,
        { cause: error, details: { file, line: index + 1, entry } },
      );
    }
  });
  if (mpns.length === 0) {
    throw new AgentError('BATCH_FILE_EMPTY', `${file} lists no part numbers`, {
      details: { file },
    });
  }
  return mpns;
}

export interface BatchOptions {
  /** Run every part again, including ones a previous batch finished. */
  readonly force: boolean;
}

export interface BatchResult {
  readonly runs: readonly FinishedRun[];
  /** Parts left alone because a run under this prompt version already finished them. */
  readonly skipped: readonly string[];
}

/**
 * Runs a list of part numbers, one after another.
 *
 * Sequential on purpose: the runs share one cache, one database and one
 * ledger, and a part whose datasheet another part already fetched should
 * find it there rather than race for it.
 *
 * Resumable by the same token. A part with a finished run under this prompt
 * version is skipped, so a batch that stopped halfway is restarted by running
 * it again. `force` runs everything regardless, which is what a changed
 * prompt at the same version would need — though changing a prompt at the
 * same version is exactly what the versioning is there to prevent.
 */
export async function extractMany(
  mpns: readonly string[],
  config: RunConfig,
  deps: RunnerDeps,
  options: BatchOptions,
): Promise<BatchResult> {
  const runs: FinishedRun[] = [];
  const skipped: string[] = [];
  for (const mpn of mpns) {
    const normalised = normaliseMpn(mpn).mpn;
    const done = options.force
      ? undefined
      : deps.context.repositories.runs.latestFinished(normalised, 'extract', config.promptVersion);
    if (done !== undefined) {
      deps.logger.info('skipping a part already run', {
        mpn: normalised,
        result: done.result,
        promptVersion: config.promptVersion,
      });
      skipped.push(normalised);
      continue;
    }
    const { run } = await extractPart(normalised, config, deps);
    runs.push(run);
  }
  return { runs, skipped };
}
