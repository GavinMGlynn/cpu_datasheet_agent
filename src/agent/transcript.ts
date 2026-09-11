import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

/** How much of one text block is kept. Enough to read, not enough to bloat. */
export const TEXT_LIMIT = 400;

export type TranscriptEntry =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'tool_use'; readonly tool: string; readonly id: string }
  | { readonly kind: 'tool_result'; readonly id: string; readonly isError: boolean }
  | {
      readonly kind: 'result';
      readonly subtype: string;
      readonly turns: number;
      readonly costUsd: number;
      readonly isError: boolean;
    };

function clip(text: string): string {
  return text.length <= TEXT_LIMIT ? text : `${text.slice(0, TEXT_LIMIT)}…`;
}

/**
 * One harness message as the few facts worth keeping.
 *
 * The ledger holds the transcript of a run, and a transcript of whole
 * messages would hold a rendered page as base64 and the whole of every
 * datasheet page that was read. What is worth keeping is the shape of the
 * run: what was said, what was called, what came back an error. The tool
 * calls themselves are recorded in full, separately, by the registry.
 */
export function condense(message: SDKMessage): TranscriptEntry[] {
  if (message.type === 'assistant') {
    const entries: TranscriptEntry[] = [];
    for (const block of message.message.content) {
      if (block.type === 'text') {
        entries.push({ kind: 'text', text: clip(block.text) });
      } else if (block.type === 'tool_use') {
        entries.push({ kind: 'tool_use', tool: block.name, id: block.id });
      }
    }
    return entries;
  }
  if (message.type === 'user') {
    const { content } = message.message;
    if (typeof content === 'string') {
      return [{ kind: 'text', text: clip(content) }];
    }
    const entries: TranscriptEntry[] = [];
    for (const block of content) {
      if (block.type === 'tool_result') {
        entries.push({
          kind: 'tool_result',
          id: block.tool_use_id,
          isError: block.is_error === true,
        });
      }
    }
    return entries;
  }
  if (message.type === 'result') {
    return [
      {
        kind: 'result',
        subtype: message.subtype,
        turns: message.num_turns,
        costUsd: message.total_cost_usd,
        isError: message.is_error,
      },
    ];
  }
  return [];
}
