import { z } from 'zod';

import {
  Classification,
  Escalation,
  NormalisedMpn,
  PartialBuckRegulatorParameters,
  Quantity,
  QuantityRange,
  Unit,
} from '../../core/index.js';
import { tryClassify } from '../../classify/index.js';
import { reconcile } from '../../reconcile/index.js';
import { parseQuantity, parseRange, parseTemperatureRange } from '../../units/index.js';
import { defineTool } from '../registry.js';
import {
  DistributorParametricsSchema,
  ReconciledParameterSchema,
  UndecidedAxisSchema,
} from '../schemas.js';
import type { ToolDefinition } from '../types.js';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false } as const;

export const normaliseValue = defineTool({
  name: 'normalise_value',
  description:
    'Turn a value as a datasheet writes it into a canonical quantity or range: SI prefixes, unit aliases, `3V3`, `-40°C to +125°C (TJ)`. Rejects anything it cannot read rather than guessing at it.',
  input: z.strictObject({
    text: z.string().min(1).max(200),
    /** The unit the value must be in. A value in another unit family is rejected. */
    unit: Unit,
    kind: z.enum(['quantity', 'range', 'temperature_range']),
  }),
  output: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('quantity'), quantity: Quantity }),
    z.strictObject({ kind: z.literal('range'), range: QuantityRange }),
    z.strictObject({
      kind: z.literal('temperature_range'),
      range: QuantityRange,
      /** Junction or ambient, when the text says which. */
      reference: z.enum(['junction', 'ambient']).nullable(),
    }),
  ]),
  annotations: READ_ONLY,
  handler: (input) => {
    if (input.kind === 'quantity') {
      return Promise.resolve({
        kind: 'quantity' as const,
        quantity: parseQuantity(input.text, input.unit),
      });
    }
    if (input.kind === 'range') {
      return Promise.resolve({ kind: 'range' as const, range: parseRange(input.text, input.unit) });
    }
    const { range, reference } = parseTemperatureRange(input.text);
    return Promise.resolve({ kind: 'temperature_range' as const, range, reference });
  },
});

export const reconcileParameters = defineTool({
  name: 'reconcile_parameters',
  description:
    'Compare extracted parameters with what the distributors publish. Agreement, conflict, or present on one side only, per parameter. A conflict on a safety rating raises an escalation and is never resolved by a rule.',
  input: z.strictObject({
    mpn: NormalisedMpn,
    parameters: PartialBuckRegulatorParameters,
    /** Facts with their provenance, as fetch_offers returns them. */
    sources: z.array(DistributorParametricsSchema),
  }),
  output: z.strictObject({
    parameters: z.array(ReconciledParameterSchema),
    /** The parameters with conflicts recorded and confidence set. Values are unchanged. */
    updated: PartialBuckRegulatorParameters,
    escalations: z.array(Escalation),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false },
  handler: (input, context) => {
    const result = reconcile(
      { mpn: input.mpn, parameters: input.parameters, sources: input.sources },
      { now: context.now, newId: context.newId },
    );
    // A safety conflict is a question for a person, so it is stored the same
    // way ask_human stores one rather than left in the reply.
    const escalations = result.escalations.map((escalation) =>
      context.repositories.escalations.create(escalation),
    );
    return Promise.resolve({
      parameters: [...result.parameters],
      updated: result.updated,
      escalations,
    });
  },
});

export const classifyPart = defineTool({
  name: 'classify_part',
  description:
    'Derive the categorisation axes from a parameter set: input voltage class, output current class, topology, integration, output type, package family, temperature grade, features. Axes it cannot decide are named, with the reason.',
  input: z.strictObject({ parameters: PartialBuckRegulatorParameters }),
  output: z.strictObject({
    classifications: z.array(Classification),
    undecided: z.array(UndecidedAxisSchema),
  }),
  annotations: READ_ONLY,
  handler: (input) => {
    const result = tryClassify(input.parameters);
    return Promise.resolve({
      classifications: [...result.classifications],
      undecided: [...result.undecided],
    });
  },
});

export const VALUE_TOOLS: readonly ToolDefinition[] = [
  normaliseValue,
  reconcileParameters,
  classifyPart,
];
