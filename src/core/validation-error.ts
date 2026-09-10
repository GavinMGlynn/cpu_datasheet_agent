import type { z } from 'zod';

import { ChipAgentError } from '../errors.js';

export interface ValidationIssue {
  /** Dot-joined path into the value, or `(root)`. */
  readonly path: string;
  readonly message: string;
  /** The offending value at `path`, when it could be located. */
  readonly received: unknown;
}

/** Thrown when a value fails one of the core schemas. Carries every issue. */
export class ValidationError extends ChipAgentError {
  readonly subject: string;
  readonly issues: readonly ValidationIssue[];

  constructor(subject: string, issues: readonly ValidationIssue[]) {
    const lines = issues.map((issue) => `  ${issue.path}: ${issue.message}`);
    super('VALIDATION_FAILED', `${subject} is invalid:\n${lines.join('\n')}`, {
      details: { subject, issues },
    });
    this.subject = subject;
    this.issues = issues;
  }
}

function valueAt(value: unknown, path: readonly PropertyKey[]): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    current = (current as Record<PropertyKey, unknown>)[segment];
  }
  return current;
}

/** Converts a Zod error into a {@link ValidationError} for `subject`. */
export function fromZodError(subject: string, error: z.ZodError, value: unknown): ValidationError {
  const issues = error.issues.map((issue) => ({
    path: issue.path.length === 0 ? '(root)' : issue.path.map(String).join('.'),
    message: issue.message,
    received: valueAt(value, issue.path),
  }));
  return new ValidationError(subject, issues);
}

/** Parses `value` with `schema`, throwing {@link ValidationError} on failure. Never coerces. */
export function parseOrThrow<T extends z.ZodType>(
  schema: T,
  value: unknown,
  subject: string,
): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw fromZodError(subject, result.error, value);
  }
  return result.data;
}
