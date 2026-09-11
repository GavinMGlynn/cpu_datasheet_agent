import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resultMessage, scriptedQuery } from '../../test/helpers/agent-sdk.js';
import { createHarness, type TestHarness } from '../../test/helpers/tool-context.js';
import { datasheet, part } from '../../test/helpers/core-fixtures.js';
import { createLogger, type Logger } from '../log/index.js';
import { NO_SPEND_POLICY, buildRegistry } from '../tools/index.js';
import { RunConfig } from './config.js';
import { AgentError } from './errors.js';
import { extractMany, readMpnList } from './batch.js';
import type { RunnerDeps } from './runner.js';

const registry = buildRegistry();

function ledgerId(n: number): string {
  return `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
}

const config: RunConfig = RunConfig.parse({
  model: 'claude-opus-5',
  effort: 'high',
  maxTurns: 12,
  maxCostUsd: 1.5,
  promptVersion: 'extract.v1',
  allowSpend: false,
  dataDir: '/tmp/chip-data',
});

let dir: string;
let harness: TestHarness;
let logger: Logger;
let logs: string[];
let issued: number;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'batch-'));
  issued = 0;
  logs = [];
  logger = createLogger({ level: 'debug', sink: (line) => logs.push(line) });
  harness = await createHarness({
    policy: NO_SPEND_POLICY,
    ledgerIdGenerator: () => ledgerId(++issued),
  });
});

afterEach(async () => {
  await harness.close();
  await rm(dir, { recursive: true, force: true });
});

async function write(name: string, contents: string): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(file, contents);
  return file;
}

describe('readMpnList', () => {
  it('reads one part number a line, normalised, ignoring blanks and comments', async () => {
    const file = await write(
      'parts.txt',
      '# buck regulators\n tps54331dr \n\nLM5164DDAR # controller\n',
    );

    expect(await readMpnList(file)).toEqual(['TPS54331DR', 'LM5164DDAR']);
  });

  it('refuses a file it cannot read, one with nothing in it, and a line that is not a part', async () => {
    await expect(readMpnList(path.join(dir, 'missing.txt'))).rejects.toThrow(AgentError);
    await expect(readMpnList(await write('empty.txt', '# nothing\n\n'))).rejects.toThrow(
      AgentError,
    );
    await expect(readMpnList(await write('bad.txt', 'TPS54331DR\n???\n'))).rejects.toThrow(
      /line 2/,
    );
  });
});

describe('extractMany', () => {
  /** A run that stores whichever part it was asked for. */
  function deps(stored: string[]): RunnerDeps {
    const { query } = scriptedQuery([resultMessage()], async (options) => {
      expect(options?.systemPrompt).toContain('No page, no store');
      const mpn = stored.shift() ?? 'TPS54331DR';
      await registry.call(
        'upsert_part',
        { part: part({ mpn, datasheet: datasheet({ pageCount: 40 }) }) },
        harness.context,
        ledgerId(issued),
      );
    });
    return { context: harness.context, registry, query, logger };
  }

  it('runs each part in turn and returns their runs', async () => {
    const result = await extractMany(
      ['tps54331dr', 'LM5164DDAR'],
      config,
      deps(['TPS54331DR', 'LM5164DDAR']),
      { force: false },
    );

    expect(result.runs.map((run) => run.mpn)).toEqual(['TPS54331DR', 'LM5164DDAR']);
    expect(result.runs.every((run) => run.result === 'extracted')).toBe(true);
    expect(result.skipped).toEqual([]);
  });

  it('skips a part a previous batch finished under the same prompt version', async () => {
    await extractMany(['TPS54331DR'], config, deps(['TPS54331DR']), { force: false });

    const again = await extractMany(['tps54331dr', 'LM5164DDAR'], config, deps(['LM5164DDAR']), {
      force: false,
    });

    expect(again.skipped).toEqual(['TPS54331DR']);
    expect(again.runs.map((run) => run.mpn)).toEqual(['LM5164DDAR']);
    expect(logs.join('\n')).toContain('skipping a part already run');
  });

  it('runs a part again under a different prompt version', async () => {
    await extractMany(['TPS54331DR'], config, deps(['TPS54331DR']), { force: false });

    const other = await extractMany(
      ['TPS54331DR'],
      { ...config, promptVersion: 'extract.v1' },
      deps(['TPS54331DR']),
      { force: true },
    );

    expect(other.skipped).toEqual([]);
    expect(other.runs).toHaveLength(1);
  });

  it('does not skip a run that never finished', async () => {
    harness.context.repositories.runs.start({
      id: '3f5a1c2e-8b7d-4e6f-9a0b-1c2d3e4f5a6b',
      mpn: 'TPS54331DR',
      kind: 'extract',
      promptVersion: 'extract.v1',
      model: 'claude-opus-5',
      startedAt: '2026-09-10T00:00:00Z',
    });

    const result = await extractMany(['TPS54331DR'], config, deps(['TPS54331DR']), {
      force: false,
    });

    expect(result.skipped).toEqual([]);
    expect(result.runs).toHaveLength(1);
  });
});
