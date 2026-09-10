import { describe, expect, expectTypeOf, it } from 'vitest';

import * as core from './index.js';
import type { Parameter } from './parameter.js';
import type { Part } from './part.js';
import type { Provenance } from './provenance.js';
import type { Quantity } from './quantity.js';

describe('core barrel', () => {
  it('re-exports every schema', () => {
    const expected = [
      'BuckRegulatorParameters',
      'Classification',
      'Datasheet',
      'Escalation',
      'Offer',
      'ParameterKey',
      'PARAMETER_KEYS',
      'parameter',
      'Part',
      'NormalisedMpn',
      'Provenance',
      'Quantity',
      'QuantityRange',
      'quantityOf',
      'rangeOf',
      'ToolCallRecord',
      'ValidationError',
      'parseOrThrow',
      'Verification',
    ];
    for (const name of expected) {
      expect(core, name).toHaveProperty(name);
    }
  });
});

describe('inferred types', () => {
  it('match the intended shapes', () => {
    expectTypeOf<Part['status']>().toEqualTypeOf<
      'extracted' | 'needs_human' | 'verified' | 'rejected'
    >();
    expectTypeOf<Part['category']>().toEqualTypeOf<'buck_regulator'>();
    expectTypeOf<Part['parameters']['vinMin']['value']>().toEqualTypeOf<{
      value: number;
      unit: 'V';
    }>();
    expectTypeOf<Part['parameters']['voutFixed']['value']>().toEqualTypeOf<{
      value: number;
      unit: 'V';
    } | null>();
    expectTypeOf<Part['parameters']['topology']['value']>().toEqualTypeOf<
      'synchronous' | 'non_synchronous'
    >();
    expectTypeOf<Part['parameters']['vinMin']>().toExtend<
      Parameter<{ value: number; unit: 'V' }>
    >();
    expectTypeOf<Provenance['source']>().toEqualTypeOf<
      'datasheet' | 'distributor' | 'human' | 'derived'
    >();
    expectTypeOf<Quantity['unit']>().toEqualTypeOf<core.Unit>();
    expectTypeOf<core.Classification['axis']>().toEqualTypeOf<
      (typeof core.CLASSIFICATION_AXES)[number]
    >();
    expectTypeOf<core.ToolCallRecord['parentId']>().toEqualTypeOf<string | undefined>();
  });
});
