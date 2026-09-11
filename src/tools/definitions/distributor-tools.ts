import { z } from 'zod';

import { NormalisedMpn, Offer } from '../../core/index.js';
import { describeError } from '../../errors.js';
import type { DistributorProvenance } from '../../core/index.js';
import type { DistributorFact } from '../../units/index.js';
import { ToolError } from '../errors.js';
import { SPEND_INPUT, spendable } from '../policy.js';
import { defineTool } from '../registry.js';
import { CandidateFailureSchema, DistributorParametricsSchema } from '../schemas.js';
import { isCacheMiss, withSpend } from '../spend.js';
import type { ToolContext, ToolDefinition } from '../types.js';

const DISTRIBUTORS = ['digikey', 'mouser'] as const;
type Wanted = (typeof DISTRIBUTORS)[number];

interface Gathered {
  readonly offers: Offer[];
  readonly sources: { provenance: DistributorProvenance; facts: DistributorFact[] }[];
  readonly siblings: string[];
  readonly unmapped: string[];
  readonly failures: { distributor: Wanted; code: string; message: string }[];
  datasheetUrl: string | undefined;
}

/**
 * The SKU the parametric facts are recorded against.
 *
 * Digi-Key's parametrics describe the product, and its SKUs describe
 * packaging variants of it, so the first variant stands for the response the
 * facts were read from. A product with no orderable variant leaves the part
 * number itself, which is what the response was keyed by.
 */
function skuFor(offers: readonly Offer[], mpn: string): string {
  return offers[0]?.sku ?? mpn;
}

async function fromDigiKey(
  context: ToolContext,
  mpn: string,
  cacheOnly: boolean,
  into: Gathered,
): Promise<void> {
  const api = context.digikey;
  if (api === undefined) {
    into.failures.push({
      distributor: 'digikey',
      code: 'TOOL_UNAVAILABLE',
      message: 'no Digi-Key credentials are configured for this run',
    });
    return;
  }
  try {
    const lookup = await api.withOptions({ cacheOnly }).lookup(mpn);
    into.offers.push(...lookup.offers);
    into.sources.push({
      provenance: {
        source: 'distributor',
        distributor: 'digikey',
        sku: skuFor(lookup.offers, lookup.mpn),
        fetchedAt: lookup.fetchedAt,
        cacheKey: lookup.cacheKey,
      },
      facts: [...lookup.facts],
    });
    into.unmapped.push(...lookup.unmapped);
    into.datasheetUrl ??= lookup.datasheetUrl;
  } catch (error) {
    if (isCacheMiss(error)) {
      throw error;
    }
    into.failures.push({ distributor: 'digikey', ...describeError(error) });
  }
}

async function fromMouser(
  context: ToolContext,
  mpn: string,
  cacheOnly: boolean,
  into: Gathered,
): Promise<void> {
  const api = context.mouser;
  if (api === undefined) {
    into.failures.push({
      distributor: 'mouser',
      code: 'TOOL_UNAVAILABLE',
      message: 'no Mouser key is configured for this run',
    });
    return;
  }
  try {
    const lookup = await api.withOptions({ cacheOnly }).lookup(mpn);
    into.offers.push(lookup.offer);
    // Mouser publishes no parametrics for switching regulators (D27), so the
    // source is recorded with an empty fact list rather than left out: that
    // it was asked and said nothing is itself worth knowing.
    into.sources.push({
      provenance: {
        source: 'distributor',
        distributor: 'mouser',
        sku: lookup.offer.sku,
        fetchedAt: lookup.fetchedAt,
        cacheKey: lookup.cacheKey,
      },
      facts: [],
    });
    into.siblings.push(...lookup.siblings);
    into.unmapped.push(...lookup.unmapped);
    into.datasheetUrl ??= lookup.datasheetUrl;
  } catch (error) {
    if (isCacheMiss(error)) {
      throw error;
    }
    into.failures.push({ distributor: 'mouser', ...describeError(error) });
  }
}

export const fetchOffers = defineTool({
  name: 'fetch_offers',
  description:
    'Distributor listings for one part number: offers with price breaks and stock, the parametric facts each distributor publishes, and the datasheet URL where one is given. A distributor that fails is reported, not thrown.',
  input: z.strictObject({
    mpn: NormalisedMpn,
    /** Defaults to every distributor configured for this run. */
    distributors: z.array(z.enum(DISTRIBUTORS)).min(1).optional(),
    ...SPEND_INPUT,
  }),
  output: spendable(
    z.strictObject({
      offers: z.array(Offer),
      /** Facts with their provenance, in the shape reconcile_parameters takes. */
      sources: z.array(DistributorParametricsSchema),
      datasheetUrl: z.string().optional(),
      siblings: z.array(z.string()),
      /** Attribute names carrying no schema parameter, so the map can grow from real data. */
      unmapped: z.array(z.string()),
      failures: z.array(CandidateFailureSchema),
    }),
  ),
  spendsQuota: true,
  annotations: { readOnlyHint: true, destructiveHint: false },
  handler: async (input, context) => {
    const wanted = input.distributors ?? DISTRIBUTORS;
    const outcome = await withSpend('fetch_offers', context, input.confirmSpend, async (mode) => {
      const gathered: Gathered = {
        offers: [],
        sources: [],
        siblings: [],
        unmapped: [],
        failures: [],
        datasheetUrl: undefined,
      };
      if (wanted.includes('digikey')) {
        await fromDigiKey(context, input.mpn, mode.cacheOnly, gathered);
      }
      if (wanted.includes('mouser')) {
        await fromMouser(context, input.mpn, mode.cacheOnly, gathered);
      }
      return gathered;
    });
    if (!outcome.ok) {
      return outcome.result;
    }
    const { datasheetUrl, ...rest } = outcome.value;
    if (rest.offers.length === 0 && rest.sources.length === 0) {
      throw new ToolError('TOOL_UNAVAILABLE', `no distributor could be asked about ${input.mpn}`, {
        details: { mpn: input.mpn, failures: rest.failures },
      });
    }
    return {
      status: 'ok' as const,
      ...rest,
      ...(datasheetUrl === undefined ? {} : { datasheetUrl }),
    };
  },
});

export const DISTRIBUTOR_TOOLS: readonly ToolDefinition[] = [fetchOffers];
export { DISTRIBUTORS };
