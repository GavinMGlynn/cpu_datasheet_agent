import { z } from 'zod';

import { Iso8601 } from './primitives.js';

/** Serialised error, matching `ChipAgentError.toJSON()`. */
export const ErrorJson = z.strictObject({
  name: z.string().min(1),
  code: z.string().min(1),
  message: z.string(),
  details: z.record(z.string(), z.json()),
  cause: z.json().optional(),
});
export type ErrorJson = z.output<typeof ErrorJson>;

/** One line of the tool-call ledger. Exactly one of `output` and `error` is present. */
export const ToolCallRecord = z
  .strictObject({
    id: z.uuid(),
    sessionId: z.string().trim().min(1).max(128),
    parentId: z.uuid().optional(),
    tool: z.string().regex(/^[a-z][a-z0-9_]*$/, { error: 'expected a snake_case tool name' }),
    input: z.json(),
    output: z.json().optional(),
    error: ErrorJson.optional(),
    startedAt: Iso8601,
    durationMs: z.number().int().min(0),
    spendsQuota: z.boolean(),
  })
  .superRefine((record, ctx) => {
    const hasOutput = record.output !== undefined;
    const hasError = record.error !== undefined;
    if (hasOutput === hasError) {
      ctx.addIssue({
        code: 'custom',
        message: 'exactly one of output and error must be present',
        path: [hasOutput ? 'error' : 'output'],
      });
    }
  });
export type ToolCallRecord = z.output<typeof ToolCallRecord>;
