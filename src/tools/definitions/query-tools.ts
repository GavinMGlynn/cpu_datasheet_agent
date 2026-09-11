import { z } from 'zod';

import { Currency, ParameterKey, Part } from '../../core/index.js';
import { AlternateQuery, findAlternates } from '../../query/index.js';
import { defineTool } from '../registry.js';
import type { ToolDefinition } from '../types.js';

const UnitPriceSchema = z.strictObject({
  amount: z.number().nonnegative(),
  currency: Currency,
  breakQuantity: z.int().positive(),
  distributor: z.string(),
  sku: z.string(),
  stock: z.int().nonnegative(),
});

const ComparisonSchema = z.strictObject({
  key: ParameterKey,
  // Whatever shape that parameter takes — a quantity, a range, a bound, an
  // enum, a boolean, or null. `Part` is where each one is pinned down; here
  // the two values are echoed back beside each other.
  reference: z.unknown(),
  candidate: z.unknown(),
  same: z.boolean(),
});

export const findAlternatesTool = defineTool({
  name: 'find_alternates',
  description:
    'Stored parts that meet a set of constraints and cost less than a reference part, cheapest first. Constraints filter and price only ranks; a part with no price in the currency asked about is still offered, last. Every answer carries the pin-compatibility disclaimer, because nothing here reads a pinout.',
  input: AlternateQuery,
  output: z.strictObject({
    reference: Part,
    referencePrice: UnitPriceSchema.nullable(),
    alternates: z.array(
      z.strictObject({
        part: Part,
        price: UnitPriceSchema.nullable(),
        /** How much cheaper than the reference, as a fraction. */
        saving: z.number().nullable(),
        comparison: z.array(ComparisonSchema),
        pinCompatibility: z.literal('not_assessed'),
      }),
    ),
    /** Parts that met the constraints and were not offered, with the reason. */
    excluded: z.array(z.strictObject({ mpn: z.string(), reason: z.string() })),
    disclaimer: z.string(),
  }),
  annotations: { readOnlyHint: true, destructiveHint: false },
  handler: (input, context) => {
    const result = findAlternates(context.repositories, input);
    return Promise.resolve({
      ...result,
      alternates: result.alternates.map((alternate) => ({
        ...alternate,
        comparison: [...alternate.comparison],
      })),
      excluded: [...result.excluded],
    });
  },
});

export const QUERY_TOOLS: readonly ToolDefinition[] = [findAlternatesTool];
