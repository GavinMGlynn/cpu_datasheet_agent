import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { preToolUse, sessionStart } from '../../test/helpers/agent-sdk.js';
import { ToolCallLedger, readLedger } from '../log/index.js';
import type { ToolCallRecord } from '../core/index.js';
import { buildRegistry } from '../tools/index.js';
import { TOOL_MATCHER, TOOL_PREFIX, createSpendGate, gateDecision } from './hook.js';

const registry = buildRegistry();
const PARENT = '3f5a1c2e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';

let dir: string;
let ledger: ToolCallLedger;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'gate-'));
  ledger = new ToolCallLedger({ dir, sessionId: 'gate-session' });
});

afterEach(async () => {
  await ledger.flush();
  await rm(dir, { recursive: true, force: true });
});

async function records(): Promise<ToolCallRecord[]> {
  await ledger.flush();
  const all: ToolCallRecord[] = [];
  for await (const record of readLedger(dir, {}, (malformed) => {
    throw new Error(JSON.stringify(malformed));
  })) {
    all.push(record);
  }
  return all;
}

describe('gateDecision', () => {
  it('refuses anything that is not one of our tools', () => {
    expect(gateDecision(registry, true, 'Bash', { command: 'ls' })).toMatchObject({
      decision: 'deny',
    });
    expect(gateDecision(registry, true, `${TOOL_PREFIX}delete_everything`, {})).toMatchObject({
      decision: 'deny',
      reason: 'there is no tool named delete_everything',
    });
  });

  it('allows a tool that spends nothing, whatever the budget', () => {
    for (const allowSpend of [true, false]) {
      expect(
        gateDecision(registry, allowSpend, `${TOOL_PREFIX}read_pages`, { pages: [1] }),
      ).toEqual({
        decision: 'allow',
        reason: 'read_pages spends nothing',
      });
    }
  });

  it('confirms the spend itself when the run may spend', () => {
    const decision = gateDecision(registry, true, `${TOOL_PREFIX}fetch_offers`, {
      mpn: 'TPS54331DR',
    });

    expect(decision.decision).toBe('allow');
    expect(decision.updatedInput).toEqual({ mpn: 'TPS54331DR', confirmSpend: true });
  });

  it('lets a run that may not spend read the cache, and refuses it the spend', () => {
    const cacheOnly = gateDecision(registry, false, `${TOOL_PREFIX}fetch_offers`, {
      mpn: 'TPS54331DR',
    });
    const asked = gateDecision(registry, false, `${TOOL_PREFIX}fetch_offers`, {
      mpn: 'TPS54331DR',
      confirmSpend: true,
    });

    expect(cacheOnly).toEqual({
      decision: 'allow',
      reason: 'fetch_offers may read the cache; a miss will come back as needs_confirmation',
    });
    expect(cacheOnly.updatedInput).toBeUndefined();
    expect(asked.decision).toBe('deny');
    expect(asked.reason).toContain('--allow-spend');
  });

  it('refuses a spending call whose input is not an object', () => {
    expect(
      gateDecision(registry, true, `${TOOL_PREFIX}fetch_offers`, ['TPS54331DR']),
    ).toMatchObject({ decision: 'deny' });
    expect(gateDecision(registry, false, `${TOOL_PREFIX}resolve_mpn`, null)).toMatchObject({
      decision: 'deny',
    });
  });
});

describe('createSpendGate', () => {
  const options = { signal: new AbortController().signal };

  it('matches the tools of one server', () => {
    expect(TOOL_MATCHER).toBe('mcp__chip__.*');
  });

  it('answers a PreToolUse event with the decision and records it', async () => {
    const gate = createSpendGate({ registry, allowSpend: true, ledger, parentId: PARENT });

    const output = await gate(
      preToolUse(`${TOOL_PREFIX}fetch_offers`, { mpn: 'TPS54331DR' }),
      'toolu_01',
      options,
    );

    expect(output).toEqual({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: "fetch_offers may spend: this run's budget allows it",
        updatedInput: { mpn: 'TPS54331DR', confirmSpend: true },
      },
    });
    const [record] = await records();
    expect(record).toMatchObject({
      tool: 'spend_gate',
      parentId: PARENT,
      spendsQuota: false,
      input: { tool: `${TOOL_PREFIX}fetch_offers`, toolUseId: 'toolu_01' },
      output: { decision: 'allow', confirmedSpend: true },
    });
  });

  it('records a refusal as plainly as a permission', async () => {
    const gate = createSpendGate({ registry, allowSpend: false, ledger, parentId: PARENT });

    const output = await gate(
      preToolUse(`${TOOL_PREFIX}resolve_mpn`, { mpn: 'TPS54331DR', confirmSpend: true }),
      undefined,
      options,
    );

    expect(output).toMatchObject({
      hookSpecificOutput: { permissionDecision: 'deny' },
    });
    expect((await records())[0]).toMatchObject({
      input: { toolUseId: null },
      output: { decision: 'deny', confirmedSpend: false },
    });
  });

  it('ignores an event that is not a tool call', async () => {
    const gate = createSpendGate({ registry, allowSpend: false, ledger, parentId: PARENT });

    expect(await gate(sessionStart(), undefined, options)).toEqual({ continue: true });
    expect(await records()).toEqual([]);
  });
});
