import { describe, expect, it } from 'vitest';

import {
  assistantText,
  assistantToolUse,
  resultMessage,
  toolResult,
} from '../../test/helpers/agent-sdk.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { TEXT_LIMIT, condense } from './transcript.js';

describe('condense', () => {
  it('keeps what an assistant said and what it called', () => {
    expect(condense(assistantText('reading the ordering table'))).toEqual([
      { kind: 'text', text: 'reading the ordering table' },
    ]);
    expect(condense(assistantToolUse('mcp__chip__read_pages', 'toolu_1', { pages: [4] }))).toEqual([
      { kind: 'tool_use', tool: 'mcp__chip__read_pages', id: 'toolu_1' },
    ]);
  });

  it('clips a long block rather than carrying a page of text', () => {
    const entries = condense(assistantText('x'.repeat(TEXT_LIMIT + 50)));

    expect(entries[0]).toEqual({ kind: 'text', text: `${'x'.repeat(TEXT_LIMIT)}…` });
  });

  it('keeps whether a tool result was an error, not what it held', () => {
    expect(condense(toolResult('toolu_1', 'a megabyte of page text'))).toEqual([
      { kind: 'tool_result', id: 'toolu_1', isError: false },
    ]);
    expect(condense(toolResult('toolu_2', 'no such datasheet', true))).toEqual([
      { kind: 'tool_result', id: 'toolu_2', isError: true },
    ]);
  });

  it('reads a user message sent as plain text', () => {
    const message = {
      type: 'user',
      uuid: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
      session_id: 's',
      parent_tool_use_id: null,
      message: { role: 'user', content: 'extract TPS54331DR' },
    } as unknown as SDKMessage;

    expect(condense(message)).toEqual([{ kind: 'text', text: 'extract TPS54331DR' }]);
  });

  it('records how the run ended', () => {
    expect(condense(resultMessage({ subtype: 'error_max_turns', numTurns: 60 }))).toEqual([
      { kind: 'result', subtype: 'error_max_turns', turns: 60, costUsd: 0.25, isError: false },
    ]);
  });

  it('keeps nothing from a message that says nothing about the run', () => {
    const system = {
      type: 'system',
      subtype: 'init',
      uuid: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
      session_id: 's',
    } as unknown as SDKMessage;

    expect(condense(system)).toEqual([]);
  });

  it('ignores a content block that is neither text nor a call', () => {
    const thinking = {
      type: 'assistant',
      uuid: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
      session_id: 's',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'which column is mine', signature: 'sig' },
          { type: 'text', text: 'the second' },
        ],
      },
    } as unknown as SDKMessage;
    const image = {
      type: 'user',
      uuid: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
      session_id: 's',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'x' } },
        ],
      },
    } as unknown as SDKMessage;

    expect(condense(thinking)).toEqual([{ kind: 'text', text: 'the second' }]);
    expect(condense(image)).toEqual([]);
  });
});
