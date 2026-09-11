import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resultMessage, scriptedQuery } from '../../test/helpers/agent-sdk.js';
import { createHarness, type TestHarness } from '../../test/helpers/tool-context.js';
import { PartDraft, parseOrThrow } from '../core/index.js';
import { ledgerFileName } from '../log/index.js';
import {
  NO_SPEND_POLICY,
  buildRegistry,
  type BuiltToolContext,
  type ToolContextOptions,
} from '../tools/index.js';
import { openDatabase } from '../db/index.js';
import { DigiKeyApi, DigiKeyClient, MemoryTokenStore } from '../adapters/digikey/index.js';
import type { Cache } from '../cache/index.js';
import { EvalCliError, USAGE, main, parseEvalCli, type EvalDeps } from './cli.js';
import { loadGoldenSet, type LoadedGolden } from './load.js';
import { readReport, resultDirName } from './report.js';

const registry = buildRegistry();
const golden = loadGoldenSet();
const found = golden[0];
if (found === undefined) {
  throw new Error('the golden set is empty');
}
const first: LoadedGolden = found;

const LOCALE = { site: 'AU', language: 'en', currency: 'AUD' } as const;

function digikeyApi(cache: Cache): DigiKeyApi {
  return new DigiKeyApi({
    client: new DigiKeyClient({
      clientId: 'id-abc',
      clientSecret: 'secret-xyz',
      locale: LOCALE,
      tokenStore: new MemoryTokenStore(),
      minIntervalMs: 0,
    }),
    cache,
    locale: LOCALE,
  });
}

function ledgerId(n: number): string {
  return `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
}

let dir: string;
let harness: TestHarness;
let out: string[];
let issued: number;

const ENV = { AGENT_MODEL: 'claude-opus-5', LOG_LEVEL: 'error' } as const;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'eval-cli-'));
  out = [];
  issued = 0;
  asked = [];
  harness = await createHarness({
    policy: NO_SPEND_POLICY,
    ledgerIdGenerator: () => ledgerId(++issued),
  });
});

afterEach(async () => {
  await harness.close();
  await rm(dir, { recursive: true, force: true });
});

function partFromGolden(entry: LoadedGolden): PartDraft {
  return parseOrThrow(
    PartDraft,
    {
      mpn: entry.part.mpn,
      manufacturer: entry.part.manufacturer,
      category: entry.part.category,
      parameters: entry.part.parameters,
      datasheet: entry.part.datasheet,
      offers: [],
      classifications: entry.part.classifications,
      verifications: [],
      status: 'extracted',
    },
    'part',
  );
}

let asked: ToolContextOptions[] = [];

function deps(overrides: Partial<EvalDeps> = {}, context = harness.context): EvalDeps {
  const { query } = scriptedQuery([resultMessage()], async () => {
    await registry.call('upsert_part', { part: partFromGolden(first) }, context, ledgerId(issued));
  });
  return {
    env: { ...ENV, DATA_DIR: dir },
    query,
    out: (line) => out.push(line),
    createContext: (options): Promise<BuiltToolContext> => {
      asked.push(options);
      return Promise.resolve({ context, db: openDatabase(':memory:') });
    },
    newId: () => 'eval-1',
    ...overrides,
  };
}

describe('parseEvalCli', () => {
  it('reads a run with its options', () => {
    expect(
      parseEvalCli([
        'run',
        '--parts',
        'TPS54331DR, LM5164DDAR',
        '--model',
        'claude-sonnet-5',
        '--max-cost',
        '2.5',
        '--effort',
        'max',
        '--out',
        'somewhere',
      ]),
    ).toEqual({
      command: 'run',
      only: ['TPS54331DR', 'LM5164DDAR'],
      out: 'somewhere',
      overrides: {
        model: 'claude-sonnet-5',
        effort: 'max',
        maxCostUsd: 2.5,
        promptVersion: 'extract.v1',
      },
    });
  });

  it('reads a run that carries an earlier one on', () => {
    expect(parseEvalCli(['run', '--resume', 'eval-1'])).toMatchObject({ resume: 'eval-1' });
  });

  it('reads compare, replay, health and help', () => {
    expect(parseEvalCli(['compare', 'a', 'b'])).toEqual({ command: 'compare', from: 'a', to: 'b' });
    expect(parseEvalCli(['replay', 'run-1'])).toEqual({ command: 'replay', id: 'run-1' });
    expect(parseEvalCli(['health'])).toEqual({ command: 'health', dir: 'eval/golden' });
    expect(parseEvalCli(['health', '--dir', 'somewhere'])).toMatchObject({ dir: 'somewhere' });
    expect(parseEvalCli(['--help'])).toEqual({ command: 'help' });
  });

  it.each([
    ['no command', []],
    ['a command it does not have', ['score']],
    ['compare with one directory', ['compare', 'a']],
    ['replay with no id', ['replay']],
    ['an option it does not have', ['run', '--fast']],
  ])('refuses %s', (_label, argv) => {
    expect(() => parseEvalCli(argv)).toThrow(EvalCliError);
  });
});

describe('main', () => {
  it('runs the golden parts it was asked for and writes a report', async () => {
    const code = await main(
      ['run', '--parts', first.part.mpn, '--out', path.join(dir, 'results')],
      deps(),
    );

    expect(code).toBe(0);
    expect(out[0]).toBe(`[1/1] ${first.part.mpn}`);
    expect(out.join('\n')).toContain('recall 100.0%');
    const directory = out[out.length - 1] ?? '';
    const report = await readReport(directory);
    expect(path.basename(directory)).toBe(resultDirName(report));
    expect(report.parts).toHaveLength(1);
    expect(report.promptVersion).toBe('extract.v1');
    // A database of its own: the tool surface can read a stored part, and a
    // run that reads the answer out of an earlier run is not a measurement.
    expect(asked[0]?.databasePath).toBe(path.join(dir, 'eval-runs', 'eval-1.sqlite'));
    expect(asked[0]?.policy).toEqual({ allowConfirmedSpend: false, autoConfirm: false });
  });

  it('compares two reports and answers 1 when something got worse', async () => {
    await main(['run', '--parts', first.part.mpn, '--out', path.join(dir, 'a')], deps());
    const before = out[out.length - 1] ?? '';
    out = [];
    // A second evaluation, on its own database, whose run stores nothing.
    const empty = await createHarness({ policy: NO_SPEND_POLICY });
    try {
      await main(
        ['run', '--parts', first.part.mpn, '--out', path.join(dir, 'b')],
        deps({ query: scriptedQuery([resultMessage()]).query }, empty.context),
      );
    } finally {
      await empty.close();
    }
    const after = out[out.length - 1] ?? '';
    out = [];

    const code = await main(['compare', before, after], deps());

    expect(code).toBe(1);
    expect(out.join('\n')).toContain('regression');
    expect(await main(['compare', before, before], deps())).toBe(0);
  });

  it('replays a run from the ledger', async () => {
    await main(['run', '--parts', first.part.mpn, '--out', path.join(dir, 'results')], deps());
    const report = await readReport(out[out.length - 1] ?? '');
    const run = report.parts[0]?.run.id ?? '';
    out = [];

    // The evaluation wrote its ledger under the data directory it was given.
    const code = await main(['replay', run], {
      ...deps(),
      env: { ...ENV, DATA_DIR: harness.root },
    });

    expect(code).toBe(0);
    expect(out.join('\n')).toContain('extract_part');
    expect(out.join('\n')).toContain('upsert_part');
  });

  it('checks the golden set and says nothing is wrong with it', async () => {
    expect(await main(['health'], deps())).toBe(0);
    expect(out).toContain('0 issue(s)');
  });

  it('answers 1 for a set that would measure the wrong thing', async () => {
    const set = path.join(dir, 'golden');
    await mkdir(set, { recursive: true });
    const one = await readFile(path.join('eval/golden', first.file), 'utf8');
    await writeFile(path.join(set, first.file), one);
    await writeFile(path.join(set, 'copy.json'), one);

    expect(await main(['health', '--dir', set], deps())).toBe(1);
    expect(out.join('\n')).toContain('duplicate_part');
  });

  it('reports a ledger line it cannot read while replaying', async () => {
    await main(['run', '--parts', first.part.mpn, '--out', path.join(dir, 'results')], deps());
    const report = await readReport(out[out.length - 1] ?? '');
    await harness.ledgerRecords();
    await writeFile(
      path.join(harness.root, 'ledger', ledgerFileName(new Date())),
      'not a record\n',
      { flag: 'a' },
    );
    out = [];

    await main(['replay', report.parts[0]?.run.id ?? ''], {
      ...deps(),
      env: { ...ENV, DATA_DIR: harness.root },
    });

    expect(out.join('\n')).toContain('unreadable ledger line');
  });

  it('prints the usage for a command line it cannot read, and for --help', async () => {
    expect(await main(['score'], deps())).toBe(2);
    expect(out.join('\n')).toContain(USAGE);
    out = [];
    expect(await main(['--help'], deps())).toBe(0);
    expect(out[0]).toBe(USAGE);
  });

  it('runs the whole golden set when no part is named', async () => {
    const code = await main(['run', '--out', path.join(dir, 'all')], deps());

    expect(code).toBe(0);
    const report = await readReport(out[out.length - 1] ?? '');
    expect(report.parts).toHaveLength(golden.length);
  });

  it('carries an earlier evaluation on, into the same database', async () => {
    await main(['run', '--parts', first.part.mpn, '--out', path.join(dir, 'a')], deps());
    out = [];

    const code = await main(
      ['run', '--parts', first.part.mpn, '--resume', 'eval-1', '--out', path.join(dir, 'b')],
      deps(),
    );

    expect(code).toBe(0);
    expect(asked[1]?.databasePath).toBe(asked[0]?.databasePath);
    const report = await readReport(out[out.length - 1] ?? '');
    expect(report.parts).toHaveLength(1);
  });

  it('answers 1 when a run wanted something the cache did not have', async () => {
    const starving = await createHarness({
      policy: NO_SPEND_POLICY,
      digikey: digikeyApi,
      ledgerIdGenerator: () => ledgerId(++issued),
    });
    try {
      const { query } = scriptedQuery([resultMessage()], async () => {
        await registry.call(
          'resolve_mpn',
          { mpn: first.part.mpn },
          starving.context,
          ledgerId(issued),
        );
      });

      const code = await main(
        ['run', '--parts', first.part.mpn, '--out', path.join(dir, 'starved')],
        deps({ query }, starving.context),
      );

      expect(code).toBe(1);
    } finally {
      await starving.close();
    }
  });

  it('refuses a run configuration that is out of bounds', async () => {
    expect(await main(['run', '--max-turns', 'plenty'], deps())).toBe(2);
  });

  it('says what went wrong rather than ending in a stack trace', async () => {
    expect(
      await main(['compare', path.join(dir, 'nowhere'), path.join(dir, 'nowhere')], deps()),
    ).toBe(2);
    expect(out.join('\n')).toContain('nowhere');
  });
});
