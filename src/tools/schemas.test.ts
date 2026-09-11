import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import { OBSERVED_KINDS } from '../core/index.js';
import type { PdfInfo } from '../pdf/index.js';
import type { PageMetrics } from '../pdf/metrics.js';
import type { DecodedMpn, MpnCandidate } from '../mpn/index.js';
import type { DistributorFact } from '../units/index.js';
import type { ReconciledParameter } from '../reconcile/index.js';
import type { UndecidedAxis } from '../classify/index.js';
import type {
  DecodedMpnSchema,
  MpnCandidateSchema,
  PageMetricsSchema,
  PdfInfoSchema,
  ReconciledParameterSchema,
  UndecidedAxisSchema,
} from './schemas.js';
import { DistributorFactSchema } from './schemas.js';

/**
 * The mirrored types declare their fields `readonly` and Zod's inferred
 * output does not, which says nothing about whether the fields match. This
 * strips the modifier from properties while leaving array mutability alone,
 * because that part does matter: a schema mirroring a `readonly` array says
 * `.readonly()`.
 */
type Writable<T> = T extends readonly (infer U)[]
  ? T extends U[]
    ? Writable<U>[]
    : readonly Writable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Writable<T[K]> }
    : T;

/**
 * Zod writes a field that may be undefined as a key that may be absent, which
 * is what a JSON tool result actually carries. This says the same thing about
 * the mirrored type so the two can be compared.
 */
type AbsentWhenUndefined<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: T[K];
};

describe('the mirrored schemas still match the types they mirror', () => {
  it('decoded part numbers', () => {
    expectTypeOf<z.output<typeof DecodedMpnSchema>>().toEqualTypeOf<Writable<DecodedMpn>>();
  });

  it('candidates', () => {
    expectTypeOf<z.output<typeof MpnCandidateSchema>>().toExtend<
      AbsentWhenUndefined<MpnCandidate>
    >();
    expectTypeOf<AbsentWhenUndefined<Writable<MpnCandidate>>>().toExtend<
      z.output<typeof MpnCandidateSchema>
    >();
  });

  it('page metrics and PDF information', () => {
    expectTypeOf<z.output<typeof PageMetricsSchema>>().toEqualTypeOf<Writable<PageMetrics>>();
    expectTypeOf<z.output<typeof PdfInfoSchema>>().toExtend<
      AbsentWhenUndefined<Writable<PdfInfo>>
    >();
    expectTypeOf<AbsentWhenUndefined<Writable<PdfInfo>>>().toExtend<
      z.output<typeof PdfInfoSchema>
    >();
  });

  it('distributor facts', () => {
    expectTypeOf<z.output<typeof DistributorFactSchema>>().toEqualTypeOf<
      Writable<DistributorFact>
    >();
  });

  it('reconciliation and classification results', () => {
    expectTypeOf<z.output<typeof ReconciledParameterSchema>>().toEqualTypeOf<
      Writable<ReconciledParameter>
    >();
    expectTypeOf<z.output<typeof UndecidedAxisSchema>>().toEqualTypeOf<Writable<UndecidedAxis>>();
  });
});

describe('DistributorFactSchema', () => {
  it('carries every observed kind, each keyed to a parameter', () => {
    const kinds = DistributorFactSchema.options.map((option) => option.shape.kind.value);
    expect([...kinds].sort()).toEqual([...OBSERVED_KINDS].sort());
  });

  it('accepts a fact as the units layer produces it', () => {
    expect(
      DistributorFactSchema.parse({
        kind: 'quantity',
        key: 'vinMax',
        value: { value: 28, unit: 'V' },
      }),
    ).toEqual({ kind: 'quantity', key: 'vinMax', value: { value: 28, unit: 'V' } });
  });

  it('rejects a fact keyed to nothing the schema knows', () => {
    expect(
      DistributorFactSchema.safeParse({
        kind: 'quantity',
        key: 'vinMaximum',
        value: { value: 28, unit: 'V' },
      }).success,
    ).toBe(false);
  });
});
