import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SESSION_ID,
  assistantText,
  resultMessage,
  scriptedQuery,
} from '../../test/helpers/agent-sdk.js';
import { TEST_NOW, createHarness, type TestHarness } from '../../test/helpers/tool-context.js';
import { datasheet, part, verificationClaim } from '../../test/helpers/core-fixtures.js';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { PARAMETER_KEYS, Part, parseOrThrow, type ParameterKey } from '../core/index.js';
import { createLogger, type Logger } from '../log/index.js';
import { NO_SPEND_POLICY, buildRegistry, type ToolRegistry } from '../tools/index.js';
import { RunConfig } from './config.js';
import { AgentError } from './errors.js';
import type { RunnerDeps } from './execute.js';
import { extractPart } from './runner.js';
import { claimsOf, verificationRequest, verifyPart, VERIFY_TOOLS } from './verify.js';

const registry: ToolRegistry = buildRegistry();
const RUN = { promptVersion: 'verify.v1', model: 'claude-opus-5' };

function ledgerId(n: number): string {
  return `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
}

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return RunConfig.parse({
    model: 'claude-opus-5',
    effort: 'high',
    maxTurns: 12,
    maxCostUsd: 1.5,
    promptVersion: 'verify.v1',
    allowSpend: false,
    dataDir: '/tmp/chip-data',
    ...overrides,
  });
}

const MESSAGES: readonly SDKMessage[] = [
  assistantText('reading page 4'),
  resultMessage({ numTurns: 6, costUsd: 0.5 }),
];

let harness: TestHarness;
let issued: number;
let logs: string[];
let logger: Logger;

beforeEach(async () => {
  issued = 0;
  logs = [];
  logger = createLogger({ level: 'debug', sink: (line) => logs.push(line) });
  harness = await createHarness({
    policy: NO_SPEND_POLICY,
    run: RUN,
    ledgerIdGenerator: () => ledgerId(++issued),
  });
});

afterEach(async () => {
  await harness.close();
});

function deps(query: RunnerDeps['query']): RunnerDeps {
  return { context: harness.context, registry, query, logger };
}

function stored(overrides: Record<string, unknown> = {}): Part {
  const one = parseOrThrow(
    Part,
    part({ datasheet: datasheet({ pageCount: 40 }), ...overrides }),
    'Part',
  );
  return harness.context.repositories.parts.upsertPart(one);
}

/** The run records a verdict for each parameter, as the real one does. */
function recording(
  verdictFor: (key: ParameterKey) => Record<string, unknown>,
  keys: readonly ParameterKey[] = PARAMETER_KEYS,
): RunnerDeps['query'] {
  return scriptedQuery(MESSAGES, async () => {
    for (const key of keys) {
      const claim = verificationClaim({ parameterKey: key, ...verdictFor(key) });
      if (claim.verdict === 'not_found') {
        delete claim.quote;
      }
      await registry.call(
        'record_verification',
        { mpn: 'TPS54331DR', verification: { ...claim, page: pageOf(key) } },
        harness.context,
        ledgerId(issued),
      );
    }
  }).query;
}

function pageOf(key: ParameterKey): number {
  const provenance = parseOrThrow(Part, part(), 'Part').parameters[key].provenance;
  return provenance.source === 'datasheet' ? provenance.page : 1;
}

describe('claimsOf', () => {
  it('groups the stored values by the page each cites, in page order', () => {
    const claims = claimsOf(parseOrThrow(Part, part(), 'Part'));

    expect(claims.map((claim) => claim.page)).toEqual([1, 2, 3, 4, 5, 8, 9, 10, 12]);
    expect(claims[0]?.parameters.map((one) => one.key)).toEqual([
      'voutFixed',
      'ioutMax',
      'topology',
      'integration',
      'aecQ100',
    ]);
    expect(claims.flatMap((claim) => claim.parameters)).toHaveLength(PARAMETER_KEYS.length);
  });

  it('leaves out a value that cites no page', () => {
    const withDistributor = parseOrThrow(
      Part,
      part({
        parameters: {
          ...(part().parameters as Record<string, unknown>),
          package: {
            value: 'SOIC-8',
            provenance: {
              source: 'distributor',
              distributor: 'digikey',
              sku: '296-1-ND',
              fetchedAt: TEST_NOW,
              cacheKey: 'c'.repeat(64),
            },
            confidence: 'extracted',
          },
        },
      }),
      'Part',
    );

    expect(claimsOf(withDistributor).flatMap((claim) => claim.parameters)).toHaveLength(
      PARAMETER_KEYS.length - 1,
    );
  });
});

describe('verificationRequest', () => {
  it('gives the claims and the pages, and nothing the extraction thought', () => {
    const one = parseOrThrow(Part, part(), 'Part');

    const request = verificationRequest(one, claimsOf(one));

    expect(request).toContain('TPS54331DR');
    expect(request).toContain('Page 4');
    expect(request).toContain('- vinMax: {"value":28,"unit":"V"}');
    expect(request).toContain('- voutFixed: null');
    expect(request).not.toContain('quote');
  });

  it('says what it does not know about a part with no datasheet attached', () => {
    const human = { source: 'human', note: 'from the ordering guide', recordedAt: TEST_NOW };
    const parameters = Object.fromEntries(
      Object.entries(part().parameters as Record<string, Record<string, unknown>>).map(
        ([key, value]) => [key, { ...value, provenance: human }],
      ),
    );
    const { datasheet: _datasheet, ...rest } = part({ parameters });
    const one = parseOrThrow(Part, rest, 'Part');

    const request = verificationRequest(one, claimsOf(one));

    expect(claimsOf(one)).toEqual([]);
    expect(request).toContain('unknown');
  });
});

describe('verifyPart', () => {
  it('marks a part verified when every value is confirmed on its page', async () => {
    stored();

    const { run, extra } = await verifyPart(
      'tps54331dr',
      config(),
      deps(recording(() => ({ verdict: 'confirmed' }))),
    );

    expect(run).toMatchObject({
      kind: 'verify',
      mpn: 'TPS54331DR',
      promptVersion: 'verify.v1',
      result: 'verified',
      details: {
        stored: true,
        escalations: 0,
        verdicts: { confirmed: 30, contradicted: 0, notFound: 0, unchecked: 0 },
      },
    });
    expect(extra.status).toBe('verified');
    expect(harness.context.repositories.parts.getPart('TPS54331DR')?.status).toBe('verified');
    expect(extra.verifications).toHaveLength(PARAMETER_KEYS.length);
    // Storing the part replaces its child rows, so the verdicts have to
    // travel with it or the pass erases its own work.
    expect(harness.context.repositories.verifications.list('TPS54331DR')).toHaveLength(
      PARAMETER_KEYS.length,
    );
  });

  it('gives the run only the tools it needs, and no way to change a value', async () => {
    stored();
    const { query, calls } = scriptedQuery(MESSAGES);

    await verifyPart('TPS54331DR', config(), deps(query));

    const options: Options = calls[0]?.options ?? {};
    expect(options.allowedTools).toEqual([
      'mcp__chip__read_pages',
      'mcp__chip__record_verification',
      'mcp__chip__render_page',
    ]);
    expect(VERIFY_TOOLS).not.toContain('upsert_part');
    expect(options.systemPrompt).toContain('You are checking values somebody else extracted');
  });

  it('starts fresh: no session resumed, none shared with the extraction', async () => {
    const extraction = scriptedQuery([resultMessage()], () => {
      stored();
      return Promise.resolve();
    });
    await extractPart(
      'TPS54331DR',
      config({ promptVersion: 'extract.v1' }),
      deps(extraction.query),
    );
    const verification = scriptedQuery(MESSAGES);

    await verifyPart('TPS54331DR', config(), deps(verification.query));

    const options: Options = verification.calls[0]?.options ?? {};
    expect(options.resume).toBeUndefined();
    expect(options.continue).toBeUndefined();
    expect(options.forkSession).toBeUndefined();
    expect(options.sessionId).toBeUndefined();
    // The request carries the claims, never the transcript that produced them.
    expect(verification.calls[0]?.prompt).not.toContain('reading the ordering table');
    const runs = harness.context.repositories.runs.list({});
    expect(runs.map((run) => run.kind).sort()).toEqual(['extract', 'verify']);
    expect(new Set(runs.map((run) => run.sessionId))).toEqual(new Set([SESSION_ID]));
  });

  it('raises a question and needs a person when a page contradicts a value', async () => {
    stored();

    const { run, extra } = await verifyPart(
      'TPS54331DR',
      config(),
      deps(
        recording((key) =>
          key === 'vinMax'
            ? { verdict: 'contradicted', quote: 'VIN 3.5 V to 60 V' }
            : { verdict: 'confirmed' },
        ),
      ),
    );

    expect(run.result).toBe('needs_human');
    expect(run.details.escalations).toBe(1);
    expect(extra.contradicted).toEqual(['vinMax']);
    expect(harness.context.repositories.parts.getPart('TPS54331DR')?.status).toBe('needs_human');
    expect(harness.context.repositories.escalations.list({ mpn: 'TPS54331DR' })).toHaveLength(1);
  });

  it('rejects a pass that left values unchecked, and says how many', async () => {
    stored();

    const { run } = await verifyPart(
      'TPS54331DR',
      config(),
      deps(recording(() => ({ verdict: 'confirmed' }), ['vinMax', 'vinMin'])),
    );

    expect(run.result).toBe('rejected');
    expect(run.details.reason).toBe('the pass confirmed 2 of 30 values: 28 left unchecked');
    expect(run.details.verdicts).toMatchObject({ confirmed: 2, unchecked: 28 });
  });

  it('rejects a pass that could not find a value, without calling it a conflict', async () => {
    stored();

    const { run } = await verifyPart(
      'TPS54331DR',
      config(),
      deps(
        recording((key) =>
          key === 'softStart' ? { verdict: 'not_found' } : { verdict: 'confirmed' },
        ),
      ),
    );

    expect(run.result).toBe('rejected');
    expect(run.details.reason).toBe(
      'the pass confirmed 29 of 30 values: 1 not found on the page they cite',
    );
    expect(run.details.escalations).toBe(0);
  });

  it('counts only the verdicts this pass recorded', async () => {
    stored();
    // An earlier pass, under an earlier prompt, said everything was fine.
    for (const key of PARAMETER_KEYS) {
      harness.context.repositories.verifications.record('TPS54331DR', {
        parameterKey: key,
        verdict: 'confirmed',
        quote: 'an older reading',
        page: 4,
        checkedAt: '2026-09-01T00:00:00Z',
        promptVersion: 'verify.v0',
        model: 'claude-opus-5',
      });
    }

    const { run } = await verifyPart(
      'TPS54331DR',
      config(),
      deps(recording(() => ({ verdict: 'confirmed' }), ['vinMax'])),
    );

    expect(run.details.verdicts).toMatchObject({ confirmed: 1, unchecked: 29 });
    expect(run.result).toBe('rejected');
  });

  it('rejects a pass the harness stopped early', async () => {
    stored();

    const { run } = await verifyPart(
      'TPS54331DR',
      config(),
      deps(scriptedQuery([resultMessage({ subtype: 'error_max_turns' })]).query),
    );

    expect(run.result).toBe('rejected');
    expect(run.details.reason).toBe(
      'the pass confirmed 0 of 30 values before the run ended as error_max_turns',
    );
  });

  it('refuses a part nobody has stored, and one with nothing to check', async () => {
    const { query } = scriptedQuery(MESSAGES);

    await expect(verifyPart('TPS54331DR', config(), deps(query))).rejects.toThrow(AgentError);

    const human = {
      source: 'human',
      note: 'read from the ordering guide',
      recordedAt: TEST_NOW,
    };
    const parameters = Object.fromEntries(
      Object.entries(part().parameters as Record<string, Record<string, unknown>>).map(
        ([key, value]) => [key, { ...value, provenance: human }],
      ),
    );
    const { datasheet: _datasheet, ...rest } = part({ parameters });
    harness.context.repositories.parts.upsertPart(parseOrThrow(Part, rest, 'Part'));

    await expect(verifyPart('TPS54331DR', config(), deps(query))).rejects.toMatchObject({
      code: 'NOTHING_TO_VERIFY',
    });
  });
});
