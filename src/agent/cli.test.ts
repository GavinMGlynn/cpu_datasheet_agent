import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resultMessage, scriptedQuery } from '../../test/helpers/agent-sdk.js';
import { createHarness, type TestHarness } from '../../test/helpers/tool-context.js';
import {
  buckParameters,
  datasheet,
  offer,
  part,
  verificationClaim,
  withConfidence,
} from '../../test/helpers/core-fixtures.js';
import { tryClassify } from '../classify/index.js';
import { PARAMETER_KEYS, Part, parseOrThrow } from '../core/index.js';
import { openDatabase } from '../db/index.js';
import { NO_SPEND_POLICY, buildRegistry, type BuiltToolContext } from '../tools/index.js';
import { AgentError } from './errors.js';
import {
  USAGE,
  main,
  parseCli,
  parseVinRange,
  planRun,
  reason,
  type MainDeps,
  type RunCommand,
} from './cli.js';

const registry = buildRegistry();
const ENV = { DATA_DIR: '/tmp/chip-data', AGENT_MODEL: 'claude-opus-5', LOG_LEVEL: 'error' };

function ledgerId(n: number): string {
  return `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
}

let dir: string;
let harness: TestHarness;
let out: string[];
let issued: number;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'cli-'));
  out = [];
  issued = 0;
  // The command line's default is a run that spends nothing, so the context
  // it would have built carries the policy that matches.
  harness = await createHarness({
    policy: NO_SPEND_POLICY,
    run: { promptVersion: 'verify.v1', model: 'claude-opus-5' },
    ledgerIdGenerator: () => ledgerId(++issued),
  });
});

afterEach(async () => {
  await harness.close();
  await rm(dir, { recursive: true, force: true });
});

/** A harness that stores the part it was asked about. */
function deps(storing = true, mpns: string[] = ['TPS54331DR']): MainDeps {
  const { query } = scriptedQuery([resultMessage()], async () => {
    if (!storing) {
      return;
    }
    await registry.call(
      'upsert_part',
      {
        part: part({ mpn: mpns.shift() ?? 'TPS54331DR', datasheet: datasheet({ pageCount: 40 }) }),
      },
      harness.context,
      ledgerId(issued),
    );
  });
  return {
    env: ENV,
    query,
    out: (line) => out.push(line),
    // The database `main` closes is its own; the harness keeps the one the
    // run actually writes to.
    createContext: (): Promise<BuiltToolContext> =>
      Promise.resolve({ context: harness.context, db: openDatabase(':memory:') }),
  };
}

describe('parseCli', () => {
  it('reads an extraction with its options', () => {
    expect(
      parseCli([
        'extract',
        'TPS54331DR',
        '--model',
        'claude-sonnet-5',
        '--effort',
        'max',
        '--max-turns',
        '30',
        '--max-cost',
        '3.5',
        '--prompt',
        'extract.v1',
        '--allow-spend',
      ]),
    ).toEqual({
      command: 'extract',
      mpn: 'TPS54331DR',
      overrides: {
        model: 'claude-sonnet-5',
        effort: 'max',
        maxTurns: 30,
        maxCostUsd: 3.5,
        promptVersion: 'extract.v1',
        allowSpend: true,
      },
    });
  });

  it('reads an alternates query', () => {
    expect(
      parseCli([
        'alternates',
        'TPS54331DR',
        '--vin',
        '8-36',
        '--iout',
        '2',
        '--qty',
        '100',
        '--currency',
        'USD',
        '--output',
        'adjustable',
        '--limit',
        '3',
        '--include-unverified',
      ]),
    ).toEqual({
      command: 'alternates',
      mpn: 'TPS54331DR',
      options: {
        vin: '8-36',
        iout: '2',
        quantity: 100,
        currency: 'USD',
        outputType: 'adjustable',
        limit: 3,
        includeUnverified: true,
      },
    });
    expect(parseCli(['alternates', 'TPS54331DR'])).toEqual({
      command: 'alternates',
      mpn: 'TPS54331DR',
      options: { includeUnverified: false },
    });
  });

  it('reads a verification and a pending sweep', () => {
    expect(parseCli(['verify', 'TPS54331DR'])).toEqual({
      command: 'verify',
      mpn: 'TPS54331DR',
      overrides: {},
    });
    expect(parseCli(['verify-pending', '--force'])).toEqual({
      command: 'verify-pending',
      force: true,
      overrides: {},
    });
  });

  it('reads a batch, with and without --force', () => {
    expect(parseCli(['extract-many', 'parts.txt'])).toEqual({
      command: 'extract-many',
      file: 'parts.txt',
      force: false,
      overrides: {},
    });
    expect(parseCli(['extract-many', 'parts.txt', '--force'])).toMatchObject({ force: true });
  });

  it('answers --help with help', () => {
    expect(parseCli(['--help'])).toEqual({ command: 'help' });
  });

  it.each([
    ['no command', []],
    ['a command it does not have', ['classify', 'TPS54331DR']],
    ['extract with no part number', ['extract']],
    ['extract-many with no file', ['extract-many']],
    ['an option it does not have', ['extract', 'TPS54331DR', '--turbo']],
    ['an argument too many', ['extract', 'TPS54331DR', 'LM5164DDAR']],
    ['verify with no part number', ['verify']],
    ['alternates with no part number', ['alternates']],
    ['verify-pending with an argument', ['verify-pending', 'TPS54331DR']],
  ])('refuses %s', (_label, argv) => {
    expect(() => parseCli(argv)).toThrow(AgentError);
  });
});

describe('parseVinRange', () => {
  it('reads a range the way a person writes one', () => {
    expect(parseVinRange('8-36')).toEqual({ unit: 'V', min: 8, max: 36 });
    expect(parseVinRange('4.5 - 60')).toEqual({ unit: 'V', min: 4.5, max: 60 });
  });

  it('refuses anything that is not a range', () => {
    expect(() => parseVinRange('36')).toThrow(AgentError);
    expect(() => parseVinRange('8 to 36')).toThrow(AgentError);
  });
});

describe('reason', () => {
  it('reads a message from anything thrown', () => {
    expect(reason(new Error('no such file'))).toBe('no such file');
    expect(reason('plain string')).toBe('plain string');
  });
});

/** The parsed form of a command that starts a run, for `planRun`. */
function parseRun(argv: readonly string[]): RunCommand {
  const command = parseCli(argv);
  if (command.command === 'help' || command.command === 'alternates') {
    throw new Error(`${command.command} does not start a run`);
  }
  return command;
}

describe('planRun', () => {
  it('builds the run configuration from the environment and the command line', () => {
    const planned = planRun(parseRun(['extract', 'TPS54331DR', '--max-turns', '5']), ENV, (line) =>
      out.push(line),
    );

    expect(planned).toMatchObject({
      kind: 'run',
      runConfig: { maxTurns: 5, model: 'claude-opus-5', allowSpend: false },
    });
  });

  it('refuses a run configuration that is out of bounds, with the usage', () => {
    expect(
      planRun(parseRun(['extract', 'X', '--max-turns', 'lots']), ENV, (line) => out.push(line)),
    ).toEqual({ kind: 'exit', code: 2 });
    expect(out.join('\n')).toContain(USAGE);
  });

  it('gives a verification run the verification prompt', () => {
    expect(planRun(parseRun(['verify', 'TPS54331DR']), ENV, () => undefined)).toMatchObject({
      runConfig: { promptVersion: 'verify.v1' },
    });
  });
});

describe('main', () => {
  it('runs one part and reports what happened', async () => {
    const code = await main(['extract', 'tps54331dr'], deps());

    expect(code).toBe(0);
    expect(out[0]).toMatch(/^TPS54331DR: extracted in 4 turns, \$0\.25, 1 tool calls$/);
  });

  it('answers 1 when the run reached no conclusion', async () => {
    expect(await main(['extract', 'TPS54331DR'], deps(false))).toBe(1);
    expect(out[0]).toContain('rejected');
  });

  it('answers 2 for a command line it cannot read, and 0 for --help', async () => {
    expect(await main(['extract'], deps())).toBe(2);
    out = [];
    expect(await main(['--help'], deps())).toBe(0);
    expect(out[0]).toBe(USAGE);
  });

  it('answers 2 for a run configuration that is out of bounds', async () => {
    expect(await main(['extract', 'TPS54331DR', '--max-turns', 'lots'], deps())).toBe(2);
  });

  it('runs a batch from a file and counts what it skipped', async () => {
    const file = path.join(dir, 'parts.txt');
    await writeFile(file, 'TPS54331DR\nLM5164DDAR\n');

    const first = await main(['extract-many', file], deps(true, ['TPS54331DR', 'LM5164DDAR']));
    const second = await main(['extract-many', file], deps(true, ['LM5164DDAR']));

    expect(first).toBe(0);
    expect(out).toContain('2 run(s), 0 skipped');
    expect(out).toContain('0 run(s), 2 skipped');
    expect(second).toBe(0);
  });

  it('answers 2 when the list of parts cannot be read', async () => {
    expect(await main(['extract-many', path.join(dir, 'missing.txt')], deps())).toBe(2);
    expect(out.join('\n')).toContain('cannot read part number list');
  });

  it('answers 1 when a run in a batch reached no conclusion', async () => {
    const file = path.join(dir, 'parts.txt');
    await writeFile(file, 'TPS54331DR\n');

    expect(await main(['extract-many', file], deps(false))).toBe(1);
  });

  it('verifies one part, and then the ones still waiting', async () => {
    await main(['extract', 'TPS54331DR'], deps());
    const checking: MainDeps = {
      ...deps(false),
      query: scriptedQuery([resultMessage()], async () => {
        for (const key of PARAMETER_KEYS) {
          await registry.call(
            'record_verification',
            {
              mpn: 'TPS54331DR',
              verification: { ...verificationClaim({ parameterKey: key }), page: 4 },
            },
            harness.context,
            ledgerId(issued),
          );
        }
      }).query,
    };
    out.length = 0;

    const one = await main(['verify', 'TPS54331DR'], checking);
    const sweep = await main(['verify-pending'], checking);

    expect(one).toBe(0);
    expect(out[0]).toContain('TPS54331DR: verified');
    // The part is verified now, so nothing is left waiting.
    expect(sweep).toBe(0);
    expect(out).toContain('0 run(s), 0 skipped');
  });

  it('answers 2 when there is no such part to verify', async () => {
    expect(await main(['verify', 'LM5164DDAR'], deps(false))).toBe(2);
    expect(out.join('\n')).toContain('no stored part LM5164DDAR');
  });

  it('answers an alternates query from what is stored, disclaimer and all', async () => {
    const parameters = buckParameters();
    const classifications = [...tryClassify(parameters).classifications];
    const priced: { mpn: string; unitPrice: number }[] = [
      { mpn: 'TPS54331DR', unitPrice: 1.42 },
      { mpn: 'LM5164DDAR', unitPrice: 0.71 },
    ];
    for (const { mpn, unitPrice } of priced) {
      harness.context.repositories.parts.upsertPart(
        parseOrThrow(
          Part,
          part({
            mpn,
            parameters: withConfidence(parameters, 'verified'),
            classifications,
            status: 'verified',
            offers: [offer({ priceBreaks: [{ quantity: 1, unitPrice }] })],
            datasheet: datasheet({ pageCount: 40 }),
          }),
          `part ${mpn}`,
        ),
      );
    }

    const code = await main(
      [
        'alternates',
        'tps54331dr',
        '--vin',
        '4-28',
        '--iout',
        '2',
        '--qty',
        '1',
        '--currency',
        'AUD',
        '--output',
        'adjustable',
        '--limit',
        '3',
      ],
      deps(),
    );

    expect(code).toBe(0);
    expect(out.join('\n')).toContain('LM5164DDAR');
    expect(out.join('\n')).toContain('50% cheaper');
    expect(out.join('\n')).toContain('not pin compatibility');
  });

  it('answers 2 for an alternates query it cannot run', async () => {
    expect(await main(['alternates', 'TPS54331DR'], deps())).toBe(2);
    expect(out.join('\n')).toContain('no stored part TPS54331DR');
    out = [];
    expect(await main(['alternates', 'TPS54331DR', '--vin', 'wide'], deps())).toBe(2);
    expect(out.join('\n')).toContain('--vin takes a range');
  });
});
