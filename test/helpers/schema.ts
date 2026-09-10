import { expect } from 'vitest';
import type { z } from 'zod';

/** Asserts that `value` parses and that parsing changes nothing (no coercion). */
export function expectAccepts<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `expected value to be accepted:\n${JSON.stringify(result.error.issues, null, 2)}`,
    );
  }
  expect(result.data).toEqual(value);
  return result.data;
}

/** Asserts that `value` is rejected, optionally at a path whose dot-joined form contains `pathPart`. */
export function expectRejects(schema: z.ZodType, value: unknown, pathPart?: string): void {
  const result = schema.safeParse(value);
  if (result.success) {
    throw new Error(`expected value to be rejected: ${JSON.stringify(value)}`);
  }
  if (pathPart !== undefined) {
    const paths = result.error.issues.map((issue) => issue.path.map(String).join('.'));
    expect(
      paths.some((path) => path.includes(pathPart)),
      `no issue at a path containing "${pathPart}"; got ${paths.join(', ')}`,
    ).toBe(true);
  }
}
