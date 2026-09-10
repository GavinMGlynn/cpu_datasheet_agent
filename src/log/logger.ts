import { LOG_LEVELS, type LogLevel } from '../config.js';

export type Fields = Readonly<Record<string, unknown>>;

export interface Logger {
  readonly level: LogLevel;
  debug(message: string, fields?: Fields): void;
  info(message: string, fields?: Fields): void;
  warn(message: string, fields?: Fields): void;
  error(message: string, fields?: Fields): void;
  /** A logger that includes `fields` in every record. */
  child(fields: Fields): Logger;
}

export interface LoggerOptions {
  readonly level: LogLevel;
  /** Receives one complete JSON line (no trailing newline). Defaults to stderr. */
  readonly sink?: (line: string) => void;
  /** Applied to the whole record before serialisation. Defaults to identity. */
  readonly redact?: (value: unknown) => unknown;
  readonly clock?: () => Date;
  readonly fields?: Fields;
}

const RANK: Readonly<Record<LogLevel, number>> = Object.freeze({
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
});

/** Writes to stderr. stdout is reserved for the MCP transport and must stay clean. */
export function stderrSink(line: string): void {
  process.stderr.write(`${line}\n`);
}

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

/**
 * Creates a structured logger. Each record is one JSON object per line with
 * `ts`, `level`, `msg`, then bound and call-site fields. Records below the
 * configured level are dropped before any work is done.
 */
export function createLogger(options: LoggerOptions): Logger {
  const sink = options.sink ?? stderrSink;
  const redactor = options.redact ?? ((value: unknown): unknown => value);
  const clock = options.clock ?? ((): Date => new Date());
  const threshold = RANK[options.level];

  function build(bound: Fields): Logger {
    const emit = (level: LogLevel, message: string, fields: Fields | undefined): void => {
      if (RANK[level] < threshold) {
        return;
      }
      const record = { ts: clock().toISOString(), level, msg: message, ...bound, ...fields };
      sink(JSON.stringify(redactor(record)));
    };
    return {
      level: options.level,
      debug: (message, fields) => {
        emit('debug', message, fields);
      },
      info: (message, fields) => {
        emit('info', message, fields);
      },
      warn: (message, fields) => {
        emit('warn', message, fields);
      },
      error: (message, fields) => {
        emit('error', message, fields);
      },
      child: (fields) => build({ ...bound, ...fields }),
    };
  }

  return build(options.fields ?? {});
}
