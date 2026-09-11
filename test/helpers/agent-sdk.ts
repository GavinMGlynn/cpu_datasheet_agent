/**
 * Builders for the messages and hook events the Claude Agent SDK produces,
 * and a scripted `query` that emits them.
 *
 * Nothing here calls the API. A run is a list of messages; a test writes the
 * list it wants the runner to see, including the ones a real run would only
 * produce by spending money.
 */
import type {
  HookInput,
  Options,
  Query,
  SDKAssistantMessage,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';

export const SESSION_ID = '7f3c1b2a-4d5e-4f60-8a9b-0c1d2e3f4a5b';

type Loose = Record<string, unknown>;

function base(overrides: Loose = {}): Loose {
  return {
    uuid: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
    session_id: SESSION_ID,
    ...overrides,
  };
}

export function assistantText(text: string): SDKAssistantMessage {
  return {
    ...base(),
    type: 'assistant',
    parent_tool_use_id: null,
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  } as unknown as SDKAssistantMessage;
}

export function assistantToolUse(name: string, id: string, input: Loose = {}): SDKAssistantMessage {
  return {
    ...base(),
    type: 'assistant',
    parent_tool_use_id: null,
    message: {
      id: 'msg_2',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5',
      content: [{ type: 'tool_use', id, name, input }],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  } as unknown as SDKAssistantMessage;
}

export function toolResult(id: string, text: string, isError = false): SDKUserMessage {
  return {
    ...base(),
    type: 'user',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: isError }],
    },
  } as unknown as SDKUserMessage;
}

export interface ResultOverrides {
  readonly subtype?: SDKResultMessage['subtype'];
  readonly isError?: boolean;
  readonly numTurns?: number;
  readonly costUsd?: number;
  readonly text?: string;
  readonly errors?: string[];
}

export function resultMessage(overrides: ResultOverrides = {}): SDKResultMessage {
  const subtype = overrides.subtype ?? 'success';
  const common = {
    ...base(),
    type: 'result',
    duration_ms: 1000,
    duration_api_ms: 900,
    is_error: overrides.isError ?? false,
    num_turns: overrides.numTurns ?? 4,
    stop_reason: 'end_turn',
    total_cost_usd: overrides.costUsd ?? 0.25,
    usage: { input_tokens: 100, output_tokens: 50 },
    modelUsage: {},
    permission_denials: [],
  };
  if (subtype === 'success') {
    return {
      ...common,
      subtype,
      result: overrides.text ?? 'stored',
    } as unknown as SDKResultMessage;
  }
  return { ...common, subtype, errors: overrides.errors ?? [] } as unknown as SDKResultMessage;
}

export function preToolUse(toolName: string, input: unknown): HookInput {
  return {
    session_id: SESSION_ID,
    transcript_path: '/dev/null',
    cwd: '/tmp',
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: input,
    tool_use_id: 'toolu_01',
  };
}

export function sessionStart(): HookInput {
  return {
    session_id: SESSION_ID,
    transcript_path: '/dev/null',
    cwd: '/tmp',
    hook_event_name: 'SessionStart',
    source: 'startup',
  };
}

export interface ScriptedQuery {
  /** What `query` was called with, in order. */
  readonly calls: { prompt: unknown; options: Options | undefined }[];
  readonly query: (params: { prompt: unknown; options?: Options }) => Query;
}

/**
 * A `query` replacement that emits a fixed list of messages.
 *
 * `onStart` runs before the first message, which is where a test can do what
 * the agent would have done: call a tool, raise an escalation, store a part.
 */
export function scriptedQuery(
  messages: readonly SDKMessage[] | ((options: Options | undefined) => readonly SDKMessage[]),
  onStart?: (options: Options | undefined) => Promise<void>,
): ScriptedQuery {
  const calls: { prompt: unknown; options: Options | undefined }[] = [];
  return {
    calls,
    query: ({ prompt, options }): Query => {
      calls.push({ prompt, options });
      const generator = (async function* emit(): AsyncGenerator<SDKMessage, void> {
        if (onStart !== undefined) {
          await onStart(options);
        }
        for (const message of typeof messages === 'function' ? messages(options) : messages) {
          yield message;
        }
      })();
      return generator as unknown as Query;
    },
  };
}

/**
 * A `query` that throws instead of running, for the harness-failed path.
 *
 * The failure arrives where a real one would: after the call is made and
 * before any message comes back.
 */
export function failingQuery(error: unknown): ScriptedQuery {
  return scriptedQuery([], async () => {
    await Promise.resolve();
    // Whatever a harness throws, not only what it should: a string is a
    // thing runtimes throw, and the runner has to survive one.
    throw error;
  });
}
