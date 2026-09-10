/**
 * Base error for everything this project throws deliberately.
 *
 * Every error carries a stable machine-readable `code`, an optional `cause`,
 * and a frozen `details` object for structured context. Subclasses pass their
 * own code. Callers branch on `code`, never on message text.
 */
export interface ChipAgentErrorOptions {
  /** Underlying error or value that caused this one. */
  readonly cause?: unknown;
  /** Structured context, frozen on construction. Must be JSON-serialisable. */
  readonly details?: Readonly<Record<string, unknown>>;
}

/** Shape produced by {@link ChipAgentError.toJSON}. Never includes a stack. */
export interface ChipAgentErrorJson {
  readonly name: string;
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

export class ChipAgentError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: string, message: string, options: ChipAgentErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.details = Object.freeze({ ...options.details });
  }

  /**
   * Serialises for logging. A `ChipAgentError` cause is serialised
   * recursively, another `Error` becomes its name and message, and any other
   * value passes through unchanged.
   */
  toJSON(): ChipAgentErrorJson {
    const json: ChipAgentErrorJson = {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    };
    return this.cause === undefined ? json : { ...json, cause: serialiseCause(this.cause) };
  }
}

/** Type guard for {@link ChipAgentError} and its subclasses. */
export function isChipAgentError(value: unknown): value is ChipAgentError {
  return value instanceof ChipAgentError;
}

function serialiseCause(cause: unknown): unknown {
  if (isChipAgentError(cause)) {
    return cause.toJSON();
  }
  if (cause instanceof Error) {
    return { name: cause.name, message: cause.message };
  }
  return cause;
}
