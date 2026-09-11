import { z } from 'zod';

import { Escalation } from '../../core/index.js';
import {
  gatherCandidates,
  normaliseMpn,
  resolveMpn,
  type CandidateSources,
} from '../../mpn/index.js';
import { SPEND_INPUT, spendable } from '../policy.js';
import { defineTool } from '../registry.js';
import {
  CandidateFailureSchema,
  CandidateSkipSchema,
  DecodedMpnSchema,
  MpnCandidateSchema,
  MpnMatchSchema,
} from '../schemas.js';
import { withSpend } from '../spend.js';
import type { ToolContext, ToolDefinition } from '../types.js';

function sourcesFor(context: ToolContext, cacheOnly: boolean): CandidateSources {
  const digikey = context.digikey?.withOptions({ cacheOnly });
  const mouser = context.mouser?.withOptions({ cacheOnly });
  return {
    ...(digikey === undefined ? {} : { digikey }),
    ...(mouser === undefined ? {} : { mouser }),
  };
}

export const resolveMpnTool = defineTool({
  name: 'resolve_mpn',
  description:
    'Work out which part a part number means: normalise it, decode the manufacturer suffix, ask the distributors what they list, and match. An exact listing wins; several plausible ones raise an ambiguous_mpn escalation instead of a guess.',
  input: z.strictObject({
    mpn: z.string().min(1).max(128),
    /** Listings to ask each distributor for. Default 10. */
    limit: z.int().positive().max(50).optional(),
    ...SPEND_INPUT,
  }),
  output: spendable(
    z.strictObject({
      query: z.string(),
      normalised: z.strictObject({
        raw: z.string(),
        mpn: z.string(),
        removed: z.array(z.string()),
      }),
      decoded: DecodedMpnSchema.nullable(),
      /** The listing this part number resolves to, or null when it does not resolve. */
      resolved: MpnCandidateSchema.nullable(),
      matches: z.array(MpnMatchSchema),
      skipped: z.array(CandidateSkipSchema),
      failures: z.array(CandidateFailureSchema),
      /** Raised and stored when the answer is not the agent's to make. */
      escalation: Escalation.nullable(),
    }),
  ),
  spendsQuota: true,
  annotations: { readOnlyHint: false, destructiveHint: false },
  handler: async (input, context) => {
    const normalised = normaliseMpn(input.mpn);
    // A distributor with nothing cached raises the cache miss out of the
    // gathering, so asking for confirmation is handled in one place rather
    // than read back out of the failures.
    const outcome = await withSpend('resolve_mpn', context, input.confirmSpend, (mode) =>
      gatherCandidates(sourcesFor(context, mode.cacheOnly), normalised.mpn, {
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      }),
    );
    if (!outcome.ok) {
      return outcome.result;
    }
    const gathering = outcome.value;
    const resolution = resolveMpn(normalised.mpn, gathering.candidates, {
      now: context.now,
      newId: context.newId,
    });
    const escalation =
      resolution.escalation === null
        ? null
        : context.repositories.escalations.create(resolution.escalation);
    return {
      status: 'ok' as const,
      query: normalised.mpn,
      normalised: { raw: normalised.raw, mpn: normalised.mpn, removed: [...normalised.removed] },
      decoded: resolution.decoded,
      resolved: resolution.resolved,
      matches: [...resolution.matches],
      skipped: [...gathering.skipped],
      failures: [...gathering.failures],
      escalation,
    };
  },
});

export const MPN_TOOLS: readonly ToolDefinition[] = [resolveMpnTool];
