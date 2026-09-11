import type {
  HookCallback,
  HookJSONOutput,
  PreToolUseHookSpecificOutput,
} from '@anthropic-ai/claude-agent-sdk';

import type { ToolCallLedger } from '../log/index.js';
import type { ToolRegistry } from '../tools/index.js';

/** The key the tool server is mounted under, so its tools are `mcp__chip__*`. */
export const SERVER_KEY = 'chip';
export const TOOL_PREFIX = `mcp__${SERVER_KEY}__`;
/** The hook matcher: every tool this run is meant to have. */
export const TOOL_MATCHER = `${TOOL_PREFIX}.*`;

export interface GateDecision {
  readonly decision: 'allow' | 'deny';
  readonly reason: string;
  /** The input to run instead, when the gate confirmed a spend on the run's behalf. */
  readonly updatedInput?: Record<string, unknown> | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether this call may go ahead, and what it should be called with.
 *
 * The rules, in order:
 *
 * - anything that is not one of this project's tools is refused: the run was
 *   given no built-in tools, so a call to one is a mistake, not a request;
 * - a tool that spends nothing is allowed;
 * - a spending tool in a run that may spend is allowed with `confirmSpend`
 *   added, because the budget was approved once, for the run, rather than per
 *   call;
 * - a spending tool in a run that may not spend is allowed **unchanged**, so
 *   it answers from the cache and reports a miss as `needs_confirmation`;
 * - the same call asking to spend anyway is denied. That is the gate: the
 *   only way to spend is a run that allows it.
 */
export function gateDecision(
  registry: ToolRegistry,
  allowSpend: boolean,
  toolName: string,
  input: unknown,
): GateDecision {
  if (!toolName.startsWith(TOOL_PREFIX)) {
    return {
      decision: 'deny',
      reason: `this run may use only the ${SERVER_KEY} tools, and ${toolName} is not one of them`,
    };
  }
  const name = toolName.slice(TOOL_PREFIX.length);
  if (!registry.has(name)) {
    return { decision: 'deny', reason: `there is no tool named ${name}` };
  }
  if (!registry.get(name).spendsQuota) {
    return { decision: 'allow', reason: `${name} spends nothing` };
  }
  if (!isRecord(input)) {
    return { decision: 'deny', reason: `${name} was called with something that is not an object` };
  }
  if (allowSpend) {
    return {
      decision: 'allow',
      reason: `${name} may spend: this run's budget allows it`,
      updatedInput: { ...input, confirmSpend: true },
    };
  }
  if (input.confirmSpend === true) {
    return {
      decision: 'deny',
      reason: `${name} asked to spend and this run may not; run it again with --allow-spend to permit it`,
    };
  }
  return {
    decision: 'allow',
    reason: `${name} may read the cache; a miss will come back as needs_confirmation`,
  };
}

export interface SpendGateOptions {
  readonly registry: ToolRegistry;
  readonly allowSpend: boolean;
  readonly ledger: ToolCallLedger;
  /** The run's own ledger entry, so every decision hangs under it. */
  readonly parentId: string;
}

/**
 * The `PreToolUse` hook: the half of the money gate that protects against
 * this agent (D12).
 *
 * Every decision is recorded in the ledger with the harness's tool-use id, so
 * a denied spend is as visible afterwards as a completed call. A hook that
 * refuses lets the run continue: the model is told why, and a cache-only
 * answer or an `ask_human` is a perfectly good ending.
 */
export function createSpendGate(options: SpendGateOptions): HookCallback {
  return async (input, toolUseId): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== 'PreToolUse') {
      return { continue: true };
    }
    const decision = gateDecision(
      options.registry,
      options.allowSpend,
      input.tool_name,
      input.tool_input,
    );
    const callId = options.ledger.begin(
      'spend_gate',
      { tool: input.tool_name, toolUseId: toolUseId ?? null, input: input.tool_input },
      { spendsQuota: false, parentId: options.parentId },
    );
    await options.ledger.end(callId, {
      output: {
        decision: decision.decision,
        reason: decision.reason,
        confirmedSpend: decision.updatedInput !== undefined,
      },
    });
    const specific: PreToolUseHookSpecificOutput = {
      hookEventName: 'PreToolUse',
      permissionDecision: decision.decision,
      permissionDecisionReason: decision.reason,
      ...(decision.updatedInput === undefined ? {} : { updatedInput: decision.updatedInput }),
    };
    return { continue: true, hookSpecificOutput: specific };
  };
}
