import type { Config } from '../config.js';
import { isChipAgentError } from '../errors.js';

export interface RedactOptions {
  /** Exact secret values. Any string containing one has that substring replaced. */
  readonly secrets?: readonly string[];
  /** Patterns for secret-shaped text (bearer tokens, key prefixes). Must use the global flag. */
  readonly patterns?: readonly RegExp[];
  /** Keys whose string values are replaced wholesale, regardless of content. */
  readonly keyPatterns?: readonly RegExp[];
  readonly replacement?: string;
}

export const DEFAULT_REPLACEMENT = '[redacted]';

/** Secrets shorter than this are ignored by value matching; they would match almost anything. */
export const MIN_SECRET_LENGTH = 6;

export const DEFAULT_SECRET_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/g,
  /\bsk-ant-[A-Za-z0-9_-]+/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
]);

export const DEFAULT_KEY_PATTERNS: readonly RegExp[] = Object.freeze([
  /secret/i,
  /token/i,
  /password/i,
  /api[-_]?key/i,
  /^authorization$/i,
  /client[-_]?id/i,
]);

/** Collects the credential values present in a validated config. */
export function secretsFromConfig(config: Config): readonly string[] {
  const candidates = [
    config.digikey.production.clientId,
    config.digikey.production.clientSecret,
    config.digikey.sandboxApp.clientId,
    config.digikey.sandboxApp.clientSecret,
    config.mouser.apiKey,
    config.farnell.apiKey,
    config.nexar.clientId,
    config.nexar.clientSecret,
    config.anthropic.apiKey,
  ];
  return candidates.filter((value): value is string => value !== undefined);
}

interface Resolved {
  readonly secrets: readonly string[];
  readonly patterns: readonly RegExp[];
  readonly keyPatterns: readonly RegExp[];
  readonly replacement: string;
}

function resolve(options: RedactOptions): Resolved {
  return {
    secrets: (options.secrets ?? []).filter((secret) => secret.length >= MIN_SECRET_LENGTH),
    patterns: options.patterns ?? DEFAULT_SECRET_PATTERNS,
    keyPatterns: options.keyPatterns ?? DEFAULT_KEY_PATTERNS,
    replacement: options.replacement ?? DEFAULT_REPLACEMENT,
  };
}

function redactString(text: string, resolved: Resolved): string {
  let result = text;
  for (const secret of resolved.secrets) {
    result = result.split(secret).join(resolved.replacement);
  }
  for (const pattern of resolved.patterns) {
    result = result.replace(pattern, resolved.replacement);
  }
  return result;
}

function isSecretKey(key: string, resolved: Resolved): boolean {
  return resolved.keyPatterns.some((pattern) => pattern.test(key));
}

function walk(value: unknown, resolved: Resolved, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return redactString(value, resolved);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (seen.has(value)) {
    return '[circular]';
  }
  seen.add(value);
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    const json = isChipAgentError(value)
      ? value.toJSON()
      : { name: value.name, message: value.message, details: {} };
    return walk(json, resolved, seen);
  }
  if (Array.isArray(value)) {
    return value.map((item) => walk(item, resolved, seen) ?? null);
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const redacted =
      typeof child === 'string' && isSecretKey(key, resolved)
        ? resolved.replacement
        : walk(child, resolved, seen);
    if (redacted !== undefined) {
      out[key] = redacted;
    }
  }
  return out;
}

/**
 * Returns a JSON-safe copy of `value` with secrets removed. Strings are
 * scrubbed of secret values and secret-shaped patterns; string values under
 * secret-looking keys are replaced wholesale. Errors become their JSON form,
 * dates become ISO strings, bigints become strings, functions and symbols are
 * dropped, and cycles become `"[circular]"`.
 */
export function redact(value: unknown, options: RedactOptions = {}): unknown {
  return walk(value, resolve(options), new WeakSet());
}

/** Builds a redactor bound to fixed options, for injection into the logger and ledger. */
export function createRedactor(options: RedactOptions = {}): (value: unknown) => unknown {
  const resolved = resolve(options);
  return (value) => walk(value, resolved, new WeakSet());
}
