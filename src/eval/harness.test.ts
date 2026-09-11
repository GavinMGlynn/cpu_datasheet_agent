import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resultMessage, scriptedQuery } from '../../test/helpers/agent-sdk.js';
import { TEST_NOW, createHarness, type TestHarness } from '../../test/helpers/tool-context.js';
import { DigiKeyApi, DigiKeyClient, MemoryTokenStore } from '../adapters/digikey/index.js';
import type { Cache } from '../cache/index.js';
import { RunConfig, type RunnerDeps } from '../agent/index.js';
import { Part, parseOrThrow } from '../core/index.js';
import { createLogger, type Logger } from '../log/index.js';
import { NO_SPEND_POLICY, buildRegistry, type ToolRegistry } from '../tools/index.js';
import { runEval } from './harness.js';
import { loadGoldenSet, type LoadedGolden } from './load.js';

const registry: ToolRegistry = buildRegistry();
const LOCALE = { site: 'AU', language: 'en', currency: 'AUD' } as const;

function ledgerId(n: number): string {
  return `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
}

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

const config: RunConfig = RunConfig.parse({
  model: 'claude-opus-5',
  effort: 'high',
  maxTurns: 12,
  maxCostUsd: 1.5,
  promptVersion: 'extract.v1',
  allowSpend: false,
  dataDir: '/tmp/chip-data',
});

/** The golden reading, stored as a part: a perfect extraction. */
function partFromGolden(entry: LoadedGolden, overrides: Record<string, unknown> = {}): Part {
  const { part } = entry;
  return parseOrThrow(
    Part,
    {
      mpn: part.mpn,
      manufacturer: part.manufacturer,
      category: part.category,
      parameters: part.parameters,
      datasheet: part.datasheet,
      offers: [],
      classifications: part.classifications,
      verifications: [],
      status: 'extracted',
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
      ...overrides,
    },
    `part from golden ${part.mpn}`,
  );
}

let harness: TestHarness;
let issued: number;
let logger: Logger;

const golden = loadGoldenSet();
const found = golden[0];
if (found === undefined) {
  throw new Error('the golden set is empty');
}
const first: LoadedGolden = found;
const two = golden.slice(0, 2);

beforeEach(async () => {
  issued = 0;
  logger = createLogger({ level: 'error', sink: () => undefined });
  harness = await createHarness({
    policy: NO_SPEND_POLICY,
    ledgerIdGenerator: () => ledgerId(++issued),
  });
});

afterEach(async () => {
  await harness.close();
});

function deps(query: RunnerDeps['query']): RunnerDeps {
  return { context: harness.context, registry, query, logger };
}

/** A run that stores whatever this function decides for each part. */
function storing(partFor: (entry: LoadedGolden) => Part | undefined): RunnerDeps['query'] {
  const queue = [...two];
  return scriptedQuery([resultMessage({ numTurns: 5, costUsd: 0.4 })], async () => {
    const entry = queue.shift();
    const stored = entry === undefined ? undefined : partFor(entry);
    if (stored !== undefined) {
      await registry.call('upsert_part', { part: stored }, harness.context, ledgerId(issued));
    }
  }).query;
}

describe('runEval', () => {
  it('scores an extraction that matched the golden reading as perfect', async () => {
    const result = await runEval({
      config,
      deps: deps(storing((entry) => partFromGolden(entry))),
      golden: two,
    });

    expect(result.parts.map((part) => part.mpn)).toEqual(two.map((entry) => entry.part.mpn));
    expect(result.set.recall).toBe(1);
    expect(result.set.precision).toBe(1);
    expect(result.set.provenanceAccuracy).toBe(1);
    expect(result.turns).toBe(10);
    expect(result.costUsd).toBeCloseTo(0.8, 5);
    expect(result.starved).toEqual([]);
    expect(result.promptVersion).toBe('extract.v1');
    expect(result.model).toBe('claude-opus-5');
  });

  it('scores a part the run never stored as one that stated nothing', async () => {
    const result = await runEval({
      config,
      deps: deps(storing(() => undefined)),
      golden: [first],
    });

    expect(result.set.recall).toBe(0);
    expect(result.parts[0]?.run.result).toBe('rejected');
    expect(result.parts[0]?.score.parameters.every((one) => one.score !== 'correct')).toBe(true);
  });

  it('runs only the parts it was asked for', async () => {
    const wanted = two[1];
    if (wanted === undefined) {
      throw new Error('the golden set has one part');
    }

    const result = await runEval({
      config,
      deps: deps(storing(() => partFromGolden(wanted))),
      golden: two,
      only: [wanted.part.mpn],
    });

    expect(result.parts.map((part) => part.mpn)).toEqual([wanted.part.mpn]);
  });

  it('says which part it is on', async () => {
    const seen: string[] = [];

    await runEval({
      config,
      deps: deps(storing((entry) => partFromGolden(entry))),
      golden: two,
      onPart: (mpn, index, total) => seen.push(`${mpn} ${String(index)}/${String(total)}`),
    });

    expect(seen).toEqual([`${two[0]?.part.mpn ?? ''} 0/2`, `${two[1]?.part.mpn ?? ''} 1/2`]);
  });

  it('reports a part whose run wanted something the cache did not have', async () => {
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

      const result = await runEval({
        config,
        deps: { context: starving.context, registry, query, logger },
        golden: [first],
      });

      expect(result.starved).toEqual([first.part.mpn]);
      expect(result.parts[0]?.cacheMisses).toBe(1);
    } finally {
      await starving.close();
    }
  });
});
