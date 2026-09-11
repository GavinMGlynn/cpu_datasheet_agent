import { appendFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SESSION_ID,
  assistantText,
  assistantToolUse,
  failingQuery,
  preToolUse,
  resultMessage,
  scriptedQuery,
  toolResult,
} from '../../test/helpers/agent-sdk.js';
import { TEST_NOW, createHarness, type TestHarness } from '../../test/helpers/tool-context.js';
import { datasheet, escalation, part } from '../../test/helpers/core-fixtures.js';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { createLogger, ledgerFileName, type Logger } from '../log/index.js';
import {
  DEFAULT_QUOTA_POLICY,
  NO_SPEND_POLICY,
  buildRegistry,
  type ToolRegistry,
} from '../tools/index.js';
import { RunConfig } from './config.js';
import { AgentError } from './errors.js';
import { TOOL_PREFIX } from './hook.js';
import { SDK_QUERY, queryOptions, type RunnerDeps } from './execute.js';
import { extractPart } from './runner.js';

const registry: ToolRegistry = buildRegistry();

function ledgerId(n: number): string {
  return `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
}

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return RunConfig.parse({
    model: 'claude-opus-5',
    effort: 'high',
    maxTurns: 12,
    maxCostUsd: 1.5,
    promptVersion: 'extract.v1',
    allowSpend: false,
    dataDir: '/tmp/chip-data',
    ...overrides,
  });
}

let harness: TestHarness;
let ledgerIds: string[];
let logs: string[];
let logger: Logger;

beforeEach(async () => {
  ledgerIds = [];
  logs = [];
  logger = createLogger({ level: 'debug', sink: (line) => logs.push(line) });
  harness = await createHarness({
    policy: NO_SPEND_POLICY,
    ledgerIdGenerator: () => {
      const id = ledgerId(ledgerIds.length + 1);
      ledgerIds.push(id);
      return id;
    },
  });
});

afterEach(async () => {
  await harness.close();
});

function deps(query: RunnerDeps['query']): RunnerDeps {
  return { context: harness.context, registry, query, logger };
}

/** The id the run's own ledger entry takes: it begins before anything else. */
const RUN_CALL = ledgerId(1);

/** What a run that did its job looks like from outside. */
async function storePart(): Promise<void> {
  await registry.call(
    'upsert_part',
    { part: part({ datasheet: datasheet({ pageCount: 40 }) }) },
    harness.context,
    RUN_CALL,
  );
}

const MESSAGES: readonly SDKMessage[] = [
  assistantText('reading the ordering table'),
  assistantToolUse(`${TOOL_PREFIX}read_pages`, 'toolu_1', { pages: [4] }),
  toolResult('toolu_1', 'page 4'),
  resultMessage({ numTurns: 7, costUsd: 0.31, text: 'stored TPS54331DR' }),
];

describe('queryOptions', () => {
  it('gives the run the tools of this project and nothing else', () => {
    const options = queryOptions(config(), 'system prompt', registry);

    expect(options.tools).toEqual([]);
    expect(options.settingSources).toEqual([]);
    expect(options.allowedTools).toContain(`${TOOL_PREFIX}upsert_part`);
    expect(options.allowedTools).toHaveLength(registry.names().length);
    expect(options.permissionPrompts).toBe('none');
    expect(options.maxBudgetUsd).toBe(1.5);
    expect(options.maxTurns).toBe(12);
    expect(options.systemPrompt).toBe('system prompt');
  });
});

describe('extractPart', () => {
  it('refuses to run when the context and the run disagree about spending', async () => {
    const spending = await createHarness({ policy: DEFAULT_QUOTA_POLICY });
    try {
      const { query } = scriptedQuery(MESSAGES);
      await expect(
        extractPart('TPS54331DR', config(), {
          context: spending.context,
          registry,
          query,
          logger,
        }),
      ).rejects.toThrow(AgentError);
    } finally {
      await spending.close();
    }
  });

  it('refuses a prompt version there is no file for', async () => {
    const { query, calls } = scriptedQuery(MESSAGES);

    await expect(
      extractPart('TPS54331DR', config({ promptVersion: 'extract.v9' }), deps(query)),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('records a run that stored a part as extracted', async () => {
    const { query, calls } = scriptedQuery(MESSAGES, storePart);

    const { run, transcript } = await extractPart('tps54331dr', config(), deps(query));

    expect(run).toMatchObject({
      mpn: 'TPS54331DR',
      kind: 'extract',
      promptVersion: 'extract.v1',
      model: 'claude-opus-5',
      sessionId: SESSION_ID,
      startedAt: TEST_NOW,
      endedAt: TEST_NOW,
      turns: 7,
      costUsd: 0.31,
      result: 'extracted',
      details: {
        subtype: 'success',
        toolCalls: 1,
        toolFailures: [],
        escalations: 0,
        spendDenials: 0,
        stored: true,
      },
    });
    expect(run.details.reason).toBeUndefined();
    expect(transcript).toEqual([
      { kind: 'text', text: 'reading the ordering table' },
      { kind: 'tool_use', tool: `${TOOL_PREFIX}read_pages`, id: 'toolu_1' },
      { kind: 'tool_result', id: 'toolu_1', isError: false },
      { kind: 'result', subtype: 'success', turns: 7, costUsd: 0.31, isError: false },
    ]);
    expect(harness.context.repositories.runs.get(run.id)).toEqual(run);
    expect(calls).toHaveLength(1);
  });

  it('asks the harness for the prompt, the tools and the gate', async () => {
    const { query, calls } = scriptedQuery(MESSAGES);

    await extractPart('TPS54331DR', config(), deps(query));

    const options: Options = calls[0]?.options ?? {};
    expect(calls[0]?.prompt).toContain('TPS54331DR');
    expect(options.systemPrompt).toContain('No page, no store');
    expect(options.mcpServers?.chip).toBeDefined();
    expect(options.cwd).toBe('/tmp/chip-data');
    const matcher = options.hooks?.PreToolUse?.[0];
    expect(matcher?.matcher).toBe('mcp__chip__.*');

    // The gate the run is given is the run's own: it denies a spend here.
    const gate = matcher?.hooks[0];
    const denial = await gate?.(
      preToolUse(`${TOOL_PREFIX}fetch_offers`, { mpn: 'TPS54331DR', confirmSpend: true }),
      'toolu_9',
      { signal: new AbortController().signal },
    );
    expect(denial).toMatchObject({
      hookSpecificOutput: { permissionDecision: 'deny' },
    });
  });

  it('counts a refused spend against the run', async () => {
    const { query } = scriptedQuery(MESSAGES, async (options) => {
      const gate = options?.hooks?.PreToolUse?.[0]?.hooks[0];
      await gate?.(preToolUse(`${TOOL_PREFIX}resolve_mpn`, { mpn: 'X', confirmSpend: true }), 'x', {
        signal: new AbortController().signal,
      });
      await storePart();
    });

    const { run } = await extractPart('TPS54331DR', config(), deps(query));

    expect(run.details.spendDenials).toBe(1);
    expect(run.result).toBe('extracted');
  });

  it('records a run that raised a question as needs_human', async () => {
    const { query } = scriptedQuery(MESSAGES, async () => {
      await registry.call(
        'ask_human',
        {
          mpn: 'TPS54331DR',
          kind: 'conflict',
          question: 'Datasheet says 28 V, Digi-Key says 30 V. Which is right?',
        },
        harness.context,
        RUN_CALL,
      );
    });

    const { run, extra } = await extractPart('TPS54331DR', config(), deps(query));

    expect(run.result).toBe('needs_human');
    expect(run.details).toMatchObject({ escalations: 1, stored: false, toolCalls: 1 });
    expect(extra.escalations).toHaveLength(1);
  });

  it('ignores a question raised before this run', async () => {
    harness.context.repositories.escalations.create(
      escalation({ mpn: 'TPS54331DR', createdAt: '2026-09-01T00:00:00Z' }),
    );
    const { query } = scriptedQuery(MESSAGES, storePart);

    const { run, extra } = await extractPart('TPS54331DR', config(), deps(query));

    expect(extra.escalations).toEqual([]);
    expect(run.result).toBe('extracted');
  });

  it('rejects a run that ran out of turns, and says so', async () => {
    const { query } = scriptedQuery([
      assistantText('still reading'),
      resultMessage({ subtype: 'error_max_turns', numTurns: 12, errors: ['turn limit reached'] }),
    ]);

    const { run } = await extractPart('TPS54331DR', config(), deps(query));

    expect(run.result).toBe('rejected');
    expect(run.details).toMatchObject({ subtype: 'error_max_turns', stored: false });
    expect(run.details.reason).toContain('error_max_turns');
    expect(run.turns).toBe(12);
  });

  it('rejects a run that stored nothing and asked nothing', async () => {
    const { query } = scriptedQuery([resultMessage({ text: 'I could not read the datasheet' })]);

    const { run } = await extractPart('TPS54331DR', config(), deps(query));

    expect(run.result).toBe('rejected');
    expect(run.details.reason).toBe(
      'the run finished without storing a part or raising a question',
    );
  });

  it('rejects a run whose harness never reported a result', async () => {
    const { query } = scriptedQuery([assistantText('working')]);

    const { run } = await extractPart('TPS54331DR', config(), deps(query));

    expect(run).toMatchObject({ result: 'rejected', turns: 0, costUsd: 0 });
    expect(run.details.subtype).toBe('no_result');
    expect(run.sessionId).toBe(SESSION_ID);
  });

  it('records a harness that crashed as a rejected run rather than throwing', async () => {
    const { query } = failingQuery(new Error('claude code executable not found'));

    const { run } = await extractPart('TPS54331DR', config(), deps(query));

    expect(run.details.subtype).toBe('harness_error');
    expect(run.details.reason).toContain('claude code executable not found');
    expect(run.sessionId).toBeUndefined();
    expect(logs.join('\n')).toContain('"msg":"run failed","kind":"extract"');
  });

  it('records something thrown that is not an error at all', async () => {
    const { query } = failingQuery('the harness said no');

    const { run } = await extractPart('TPS54331DR', config(), deps(query));

    expect(run.details.reason).toContain('the harness said no');
  });

  it('reports a ledger line it cannot read and counts the rest', async () => {
    const { query } = scriptedQuery(MESSAGES, async () => {
      await storePart();
      await appendFile(
        path.join(harness.root, 'ledger', ledgerFileName(new Date())),
        'this is not a record\n',
      );
    });

    const { run } = await extractPart('TPS54331DR', config(), deps(query));

    expect(run.details.toolCalls).toBe(1);
    expect(logs.join('\n')).toContain('unreadable ledger line');
  });

  it('counts a tool call that failed without calling the run a failure', async () => {
    const { query } = scriptedQuery(MESSAGES, async () => {
      await registry
        .call('pdf_info', { sha256: 'f'.repeat(64) }, harness.context, RUN_CALL)
        .catch(() => undefined);
      await storePart();
    });

    const { run } = await extractPart('TPS54331DR', config(), deps(query));

    expect(run.details.toolFailures).toEqual(['pdf_info']);
    expect(run.result).toBe('extracted');
  });

  it('writes the whole run into the ledger, with every call beneath it', async () => {
    const { query } = scriptedQuery(MESSAGES, storePart);

    const { run } = await extractPart('TPS54331DR', config(), deps(query));

    const records = await harness.ledgerRecords();
    const parent = records.find((record) => record.tool === 'extract_part');
    expect(parent?.id).toBe(RUN_CALL);
    expect(parent?.input).toMatchObject({
      mpn: 'TPS54331DR',
      promptVersion: 'extract.v1',
      model: 'claude-opus-5',
      allowSpend: false,
    });
    expect(parent?.output).toMatchObject({ run: { id: run.id, result: 'extracted' } });
    expect(records.filter((record) => record.parentId === RUN_CALL).map((one) => one.tool)).toEqual(
      ['upsert_part'],
    );
  });
});

describe('SDK_QUERY', () => {
  it('is the harness itself, so only a test replaces it', () => {
    expect(typeof SDK_QUERY).toBe('function');
  });
});
