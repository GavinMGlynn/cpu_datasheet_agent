import { ChipAgentError, isChipAgentError } from '../../errors.js';

/**
 * An HTTP failure raised by the web layer itself, where the status is the
 * point rather than something inferred. Everything thrown by the modules
 * underneath is mapped by {@link failureFor}.
 */
export class WebError extends ChipAgentError {
  readonly status: number;

  constructor(
    status: number,
    code: string,
    message: string,
    options: ConstructorParameters<typeof ChipAgentError>[2] = {},
  ) {
    super(code, message, options);
    this.status = status;
  }
}

export interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly status: number;
    /** Structured context, present only on client errors. Always redacted. */
    readonly details?: unknown;
  };
}

export interface Failure {
  readonly status: number;
  readonly body: ErrorBody;
  /** True when the server is at fault and the full error belongs in the log. */
  readonly internal: boolean;
}

/**
 * Codes whose status is not what their class would suggest.
 *
 * A cache miss is 409 rather than 404 because the resource exists and the run
 * simply may not pay for it; the browser turns that into "allow this to
 * spend?" A budget refusal is 402 for the same reason — the request was
 * understood, the money said no.
 */
const BY_CODE: Readonly<Record<string, number>> = Object.freeze({
  VALIDATION_FAILED: 400,
  AUTH_REFUSED: 401,
  AUTH_LOCKED_OUT: 429,
  AUTH_PASSWORD_TOO_SHORT: 400,
  AUTH_PASSWORD_TOO_LONG: 400,
  AUTH_ACCOUNT_EXISTS: 409,
  AUTH_ACCOUNT_NOT_FOUND: 404,
  AUTH_HASH_UNREADABLE: 500,
  AUTH_OIDC_STATE: 403,
  AUTH_OIDC_PROVIDER: 502,
  AUTH_NO_ACCOUNT: 403,
  WEB_BAD_PATH: 400,
  WEB_ROUTE_PATTERN: 500,
  CLI_USAGE: 400,
  CACHE_MISS: 409,
  NEXAR_BUDGET_EXHAUSTED: 402,
  DB_DUPLICATE_RUN: 409,
  DB_DUPLICATE_ESCALATION: 409,
  DB_ESCALATION_ALREADY_RESOLVED: 409,
  DB_RUN_ALREADY_FINISHED: 409,
  DB_OPEN_FAILED: 500,
  DB_ROW_MISSING: 500,
});

/** Fallback by error class, read from the name every `ChipAgentError` sets. */
const BY_CLASS: Readonly<Record<string, number>> = Object.freeze({
  ValidationError: 400,
  AuthError: 401,
  LockedOutError: 429,
  PasswordError: 400,
  OidcError: 403,
  JwtError: 403,
  QueryError: 400,
  MpnError: 400,
  ParseError: 400,
  UnitMismatchError: 400,
  UnitRangeError: 400,
  ToolError: 400,
  PromptError: 400,
  EvalCliError: 400,
  ReplayError: 404,
  CacheMissError: 409,
  BudgetExhaustedError: 402,
  DigiKeyError: 502,
  MouserError: 502,
  PdfFetchError: 502,
  ConfigError: 503,
  PopplerMissingError: 503,
});

function statusFromCode(code: string): number | undefined {
  const exact = BY_CODE[code];
  if (exact !== undefined) {
    return exact;
  }
  if (code.endsWith('_NOT_FOUND')) {
    return 404;
  }
  return undefined;
}

/** The status an error becomes. Exported for the tests that pin the table. */
export function statusFor(error: unknown): number {
  if (error instanceof WebError) {
    return error.status;
  }
  if (!isChipAgentError(error)) {
    return 500;
  }
  return statusFromCode(error.code) ?? BY_CLASS[error.name] ?? 500;
}

/**
 * Turns anything thrown into a response body.
 *
 * Two rules hold whatever the error was. Details ride along only on client
 * errors, because a 500's context is for the log and not for the page; and
 * everything that does go out passes through the redactor first, since this
 * process holds distributor and model credentials and an error message is as
 * good a place to leak one as any (D67).
 */
export function failureFor(error: unknown, redact: (value: unknown) => unknown): Failure {
  const status = statusFor(error);
  const internal = status >= 500;
  if (!isChipAgentError(error)) {
    return {
      status,
      internal,
      body: {
        error: {
          code: 'INTERNAL',
          message: 'the server failed to handle the request',
          status,
        },
      },
    };
  }
  const message = String(redact(error.message));
  const details = internal ? undefined : redact(error.details);
  return {
    status,
    internal,
    body: {
      error: {
        code: error.code,
        message,
        status,
        ...(details === undefined ? {} : { details }),
      },
    },
  };
}
