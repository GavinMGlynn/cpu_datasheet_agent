import { z } from 'zod';

import {
  CLASSIFICATION_AXES,
  Category,
  NormalisedMpn,
  ParameterKey,
  Part,
  PartStatus,
  Verification,
} from '../../core/index.js';
import { ToolError } from '../errors.js';
import { defineTool } from '../registry.js';
import type { ToolDefinition } from '../types.js';

/**
 * Stores a whole part, or rejects it.
 *
 * The input schema is the `Part` schema itself, so what the tool advertises
 * and what the database enforces are one thing. Nothing is coerced: a value
 * of the wrong shape is a rejection, not a repair.
 */
export const upsertPart = defineTool({
  name: 'upsert_part',
  description:
    'Store a part: parameters with provenance, offers, classifications, verifications. Validates the whole aggregate and rejects it on any violation; it never coerces a value into fitting.',
  input: z.strictObject({ part: Part }),
  output: z.strictObject({ part: Part }),
  annotations: { readOnlyHint: false, destructiveHint: true },
  handler: (input, context) =>
    Promise.resolve({ part: context.repositories.parts.upsertPart(input.part) }),
});

export const getPart = defineTool({
  name: 'get_part',
  description: 'One stored part by part number, or null when it is not stored.',
  input: z.strictObject({ mpn: NormalisedMpn }),
  output: z.strictObject({ part: Part.nullable() }),
  annotations: { readOnlyHint: true, destructiveHint: false },
  handler: (input, context) =>
    Promise.resolve({ part: context.repositories.parts.getPart(input.mpn) ?? null }),
});

export const searchParts = defineTool({
  name: 'search_parts',
  description:
    'Stored parts matching a filter: category, status, classification axes, and numeric parameter bounds. A parameter bound is checked against the whole of a range, not its midpoint.',
  input: z.strictObject({
    category: Category.optional(),
    status: PartStatus.optional(),
    classifications: z
      .array(z.strictObject({ axis: z.enum(CLASSIFICATION_AXES), value: z.string() }))
      .optional(),
    parameters: z
      .array(
        z.strictObject({
          key: ParameterKey,
          /** The value, or the whole of a range, must be at least this. */
          min: z.number().optional(),
          /** The value, or the whole of a range, must be at most this. */
          max: z.number().optional(),
        }),
      )
      .optional(),
    limit: z.int().positive().max(200).optional(),
  }),
  output: z.strictObject({ parts: z.array(Part) }),
  annotations: { readOnlyHint: true, destructiveHint: false },
  handler: (input, context) =>
    Promise.resolve({
      parts: context.repositories.parts.findParts({ ...input, limit: input.limit ?? 20 }),
    }),
});

export const recordVerification = defineTool({
  name: 'record_verification',
  description:
    'Record one verification verdict against a stored parameter: confirmed, contradicted, or not found on the page it cites.',
  input: z.strictObject({ mpn: NormalisedMpn, verification: Verification }),
  output: z.strictObject({ verification: Verification }),
  annotations: { readOnlyHint: false, destructiveHint: false },
  handler: (input, context) => {
    if (context.repositories.parts.getPartId(input.mpn) === undefined) {
      throw new ToolError(
        'TOOL_NOT_FOUND',
        `no stored part ${input.mpn} to record a verification against`,
        { details: { mpn: input.mpn } },
      );
    }
    return Promise.resolve({
      verification: context.repositories.verifications.record(input.mpn, input.verification),
    });
  },
});

export const PART_TOOLS: readonly ToolDefinition[] = [
  upsertPart,
  getPart,
  searchParts,
  recordVerification,
];
