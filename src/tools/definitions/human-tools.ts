import { z } from 'zod';

import { Escalation, EscalationKind, NormalisedMpn } from '../../core/index.js';
import { defineTool } from '../registry.js';
import type { ToolContext, ToolDefinition } from '../types.js';

/**
 * Marks the part as needing a person, when there is a part to mark.
 *
 * An escalation raised before the part is stored has nothing to mark, which
 * is not a failure: the escalation is the record, and the part will be stored
 * with whatever status the run ends in.
 */
function markNeedsHuman(context: ToolContext, mpn: string): boolean {
  const part = context.repositories.parts.getPart(mpn);
  if (part === undefined || part.status === 'needs_human' || part.status === 'rejected') {
    return false;
  }
  context.repositories.parts.upsertPart({
    ...part,
    status: 'needs_human',
    updatedAt: context.now(),
  });
  return true;
}

export const askHuman = defineTool({
  name: 'ask_human',
  description:
    'Hand a question to a person: a conflicting value, an ambiguous part number, a rating nobody can read. Records the question and returns; it never waits for an answer.',
  input: z.strictObject({
    mpn: NormalisedMpn,
    kind: EscalationKind,
    question: z.string().trim().min(1).max(2000),
    /** Anything a person needs to answer it: both values, the page, the candidates. */
    context: z.record(z.string(), z.json()).optional(),
    options: z.array(z.string().trim().min(1).max(500)).min(2).optional(),
  }),
  output: z.strictObject({
    id: z.uuid(),
    createdAt: z.string(),
    /** True when the part was moved to `needs_human` by this call. */
    markedNeedsHuman: z.boolean(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false },
  handler: (input, context) => {
    const escalation = context.repositories.escalations.create({
      id: context.newId(),
      mpn: input.mpn,
      kind: input.kind,
      question: input.question,
      context: input.context ?? {},
      ...(input.options === undefined ? {} : { options: input.options }),
      createdAt: context.now(),
    });
    // Headless, nobody is going to answer during this run, so the part is
    // marked and the run ends cleanly rather than waiting.
    const marked = context.headless && markNeedsHuman(context, input.mpn);
    return Promise.resolve({
      id: escalation.id,
      createdAt: escalation.createdAt,
      markedNeedsHuman: marked,
    });
  },
});

export const listEscalations = defineTool({
  name: 'list_escalations',
  description: 'Questions waiting for a person, newest first.',
  input: z.strictObject({
    mpn: NormalisedMpn.optional(),
    kind: EscalationKind.optional(),
    /** true: only answered; false: only waiting; omitted: both. */
    resolved: z.boolean().optional(),
    limit: z.int().positive().max(200).optional(),
  }),
  output: z.strictObject({ escalations: z.array(Escalation) }),
  annotations: { readOnlyHint: true, destructiveHint: false },
  handler: (input, context) => {
    const { limit, ...filter } = input;
    return Promise.resolve({
      escalations: context.repositories.escalations.list(filter).slice(0, limit ?? 50),
    });
  },
});

export const HUMAN_TOOLS: readonly ToolDefinition[] = [askHuman, listEscalations];
