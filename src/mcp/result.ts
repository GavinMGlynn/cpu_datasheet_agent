import { z } from 'zod';

import { isChipAgentError } from '../errors.js';
import type { ContentBlock, ToolDefinition } from '../tools/index.js';

/**
 * The shape both adapters return; each SDK's own type is structurally this.
 * Mutable arrays, because that is what the SDKs' own result types declare.
 * The index signature is theirs too: an MCP result may carry `_meta` and
 * whatever a later revision adds, and without it this does not satisfy them.
 */
export interface CallResult {
  content: ContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}

/** Pretty JSON, because a person reads these in a transcript as often as a model does. */
export function jsonBlock(value: unknown): ContentBlock {
  return { type: 'text', text: JSON.stringify(value, null, 2) };
}

/**
 * Whether a tool's output is an object, and so can be carried as
 * `structuredContent` under a declared output schema.
 *
 * The spending tools answer with a union — the result, or a request to
 * confirm — which is not an object schema, so they travel as text. The
 * registry has already validated either way; this only decides how the
 * answer is carried.
 */
export function isObjectSchema(schema: z.ZodType): schema is z.ZodObject {
  return schema instanceof z.ZodObject;
}

/** Turns a validated tool output into the blocks a client receives. */
export function toCallResult(definition: ToolDefinition, output: unknown): CallResult {
  const content = [...(definition.content?.(output) ?? [jsonBlock(output)])];
  if (isObjectSchema(definition.output) && typeof output === 'object' && output !== null) {
    return { content, structuredContent: { ...output } };
  }
  return { content };
}

/**
 * Turns a thrown error into an error result carrying the code.
 *
 * A tool that fails is not a transport failure, so it comes back as a result
 * the model can read and act on: the code is the part it can branch on, and
 * `ask_human` is usually the right next call.
 */
export function toErrorResult(error: unknown): CallResult {
  const described = isChipAgentError(error)
    ? error.toJSON()
    : { name: 'Error', code: 'UNKNOWN', message: String(error), details: {} };
  return { content: [jsonBlock(described)], isError: true };
}
