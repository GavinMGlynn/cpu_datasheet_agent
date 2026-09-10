import { z } from 'zod';

/** Canonical SI units used by the buck-regulator schema. */
export const UNITS = ['V', 'A', 'Hz', 's', 'Ohm', 'W', 'degC', 'percent', 'count'] as const;
export const Unit = z.enum(UNITS);
export type Unit = z.output<typeof Unit>;

interface IssueContext {
  addIssue: (issue: { code: 'custom'; message: string; path: PropertyKey[] }) => void;
}

function checkMagnitude(unit: Unit, value: number, ctx: IssueContext, path: PropertyKey[]): void {
  if (unit !== 'degC' && value < 0) {
    ctx.addIssue({ code: 'custom', message: `${unit} values cannot be negative`, path });
  }
  if (unit === 'percent' && value > 100) {
    ctx.addIssue({ code: 'custom', message: 'percent values cannot exceed 100', path });
  }
}

/**
 * A single measured value. Numbers only: a string such as `"3.3V"` is rejected,
 * never parsed. Every unit except `degC` must be non-negative; `percent` is
 * capped at 100.
 */
export const Quantity = z
  .strictObject({ value: z.number(), unit: Unit })
  .superRefine((quantity, ctx) => {
    checkMagnitude(quantity.unit, quantity.value, ctx, ['value']);
  });
export type Quantity = z.output<typeof Quantity>;

/** A {@link Quantity} pinned to one unit, so a voltage field cannot hold amps. */
export function quantityOf<U extends Unit>(
  unit: U,
): z.ZodObject<{ value: z.ZodNumber; unit: z.ZodLiteral<U> }, z.core.$strict> {
  return z
    .strictObject({ value: z.number(), unit: z.literal(unit) })
    .superRefine((quantity, ctx) => {
      checkMagnitude(unit, quantity.value, ctx, ['value']);
    });
}

interface RangeShape {
  unit: Unit;
  min: number;
  max: number;
  typ?: number | undefined;
}

function checkRange(range: RangeShape, ctx: IssueContext): void {
  checkMagnitude(range.unit, range.min, ctx, ['min']);
  checkMagnitude(range.unit, range.max, ctx, ['max']);
  if (range.min > range.max) {
    ctx.addIssue({
      code: 'custom',
      message: 'max must be greater than or equal to min',
      path: ['max'],
    });
  }
  if (range.typ !== undefined) {
    checkMagnitude(range.unit, range.typ, ctx, ['typ']);
    if (range.typ < range.min || range.typ > range.max) {
      ctx.addIssue({ code: 'custom', message: 'typ must lie between min and max', path: ['typ'] });
    }
  }
}

/**
 * A min/max pair with an optional typical value, all in one unit. Distinct
 * from {@link Quantity}: a single value is never silently promoted to a range.
 */
export const QuantityRange = z
  .strictObject({ unit: Unit, min: z.number(), max: z.number(), typ: z.number().optional() })
  .superRefine(checkRange);
export type QuantityRange = z.output<typeof QuantityRange>;

/** A {@link QuantityRange} pinned to one unit. */
export function rangeOf<U extends Unit>(
  unit: U,
): z.ZodObject<
  { unit: z.ZodLiteral<U>; min: z.ZodNumber; max: z.ZodNumber; typ: z.ZodOptional<z.ZodNumber> },
  z.core.$strict
> {
  return z
    .strictObject({
      unit: z.literal(unit),
      min: z.number(),
      max: z.number(),
      typ: z.number().optional(),
    })
    .superRefine((range, ctx) => {
      checkRange(range, ctx);
    });
}
