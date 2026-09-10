import path from 'node:path';

import { z } from 'zod';

import { ChipAgentError } from './errors.js';
import { deepFreeze } from './util/deep-freeze.js';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const AGENT_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AgentEffort = (typeof AGENT_EFFORTS)[number];

export interface DigiKeyLocale {
  readonly site: string;
  readonly language: string;
  readonly currency: string;
}

export interface DigiKeyConfig {
  readonly clientId: string | undefined;
  readonly clientSecret: string | undefined;
  readonly sandbox: boolean;
  readonly locale: DigiKeyLocale;
}

export interface MouserConfig {
  readonly apiKey: string | undefined;
}

export interface NexarConfig {
  readonly clientId: string | undefined;
  readonly clientSecret: string | undefined;
  readonly enabled: boolean;
  /** Hard ceiling on parts ever requested from Nexar. */
  readonly budgetLimit: number;
}

export interface AnthropicConfig {
  readonly apiKey: string | undefined;
}

export interface AgentConfig {
  readonly model: string;
  readonly effort: AgentEffort;
}

/** Validated, deeply frozen configuration. */
export interface Config {
  readonly digikey: DigiKeyConfig;
  readonly mouser: MouserConfig;
  readonly nexar: NexarConfig;
  readonly anthropic: AnthropicConfig;
  readonly agent: AgentConfig;
  /** Absolute path to the runtime data directory. */
  readonly dataDir: string;
  readonly logLevel: LogLevel;
  readonly liveTests: boolean;
}

export interface ConfigIssue {
  readonly variable: string;
  readonly message: string;
}

/** Thrown by {@link loadConfig}. Lists every problem at once. */
export class ConfigError extends ChipAgentError {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    const lines = issues.map((issue) => `  ${issue.variable}: ${issue.message}`);
    super('CONFIG_INVALID', `Invalid configuration:\n${lines.join('\n')}`, {
      details: { issues },
    });
    this.issues = issues;
  }
}

export interface LoadConfigOptions {
  /** Directory that relative `DATA_DIR` values resolve against. Defaults to the process working directory. */
  readonly cwd?: string;
}

/** Anything shaped like `process.env`. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

const TRUE_WORDS: ReadonlySet<string> = new Set(['1', 'true', 'yes', 'on']);
const FALSE_WORDS: ReadonlySet<string> = new Set(['0', 'false', 'no', 'off']);

interface Issuer {
  addIssue: (issue: { code: 'custom'; message: string }) => void;
}

function fail(ctx: Issuer, message: string): typeof z.NEVER {
  ctx.addIssue({ code: 'custom', message });
  return z.NEVER;
}

/** Raw variable with blank values collapsed to `undefined`. */
const envString = z
  .string()
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  });

function envStringWithDefault(defaultValue: string) {
  return envString.transform((value) => value ?? defaultValue);
}

function envBoolean(defaultValue: boolean) {
  return envString.transform((value, ctx) => {
    if (value === undefined) {
      return defaultValue;
    }
    const word = value.toLowerCase();
    if (TRUE_WORDS.has(word)) {
      return true;
    }
    if (FALSE_WORDS.has(word)) {
      return false;
    }
    return fail(ctx, `expected a boolean (1/0/true/false/yes/no/on/off), received "${value}"`);
  });
}

function envInteger(defaultValue: number, min: number, max: number) {
  return envString.transform((value, ctx) => {
    if (value === undefined) {
      return defaultValue;
    }
    if (!/^-?\d+$/.test(value)) {
      return fail(ctx, `expected an integer, received "${value}"`);
    }
    const parsed = Number(value);
    if (parsed < min || parsed > max) {
      return fail(
        ctx,
        `expected an integer between ${String(min)} and ${String(max)}, received ${value}`,
      );
    }
    return parsed;
  });
}

function envEnum<T extends string>(values: readonly T[], defaultValue: T) {
  const isMember = (candidate: string): candidate is T =>
    (values as readonly string[]).includes(candidate);
  return envString.transform((value, ctx) => {
    if (value === undefined) {
      return defaultValue;
    }
    if (isMember(value)) {
      return value;
    }
    return fail(ctx, `expected one of ${values.join(', ')}, received "${value}"`);
  });
}

function envPattern(regex: RegExp, description: string, defaultValue: string) {
  return envString.transform((value, ctx) => {
    if (value === undefined) {
      return defaultValue;
    }
    if (regex.test(value)) {
      return value;
    }
    return fail(ctx, `expected ${description}, received "${value}"`);
  });
}

const envSchema = z.object({
  DIGIKEY_CLIENT_ID: envString,
  DIGIKEY_CLIENT_SECRET: envString,
  DIGIKEY_SANDBOX: envBoolean(false),
  DIGIKEY_LOCALE_SITE: envPattern(/^[A-Z]{2}$/, 'a two-letter uppercase country code', 'AU'),
  DIGIKEY_LOCALE_LANGUAGE: envPattern(/^[a-z]{2}$/, 'a two-letter lowercase language code', 'en'),
  DIGIKEY_LOCALE_CURRENCY: envPattern(
    /^[A-Z]{3}$/,
    'a three-letter uppercase currency code',
    'AUD',
  ),
  MOUSER_API_KEY: envString,
  NEXAR_CLIENT_ID: envString,
  NEXAR_CLIENT_SECRET: envString,
  NEXAR_ENABLED: envBoolean(false),
  NEXAR_BUDGET_LIMIT: envInteger(90, 0, 100),
  ANTHROPIC_API_KEY: envString,
  AGENT_MODEL: envPattern(
    /^[a-z0-9][a-z0-9.-]*$/,
    'a model ID such as claude-opus-5',
    'claude-opus-5',
  ),
  AGENT_EFFORT: envEnum(AGENT_EFFORTS, 'high'),
  DATA_DIR: envStringWithDefault('./data'),
  LOG_LEVEL: envEnum(LOG_LEVELS, 'info'),
  LIVE_TESTS: envBoolean(false),
});

/** Every environment variable the project reads, in declaration order. */
export const ENV_VARIABLE_NAMES: readonly string[] = Object.freeze(Object.keys(envSchema.shape));

/**
 * Validates the environment and returns a frozen {@link Config}.
 *
 * Blank values count as unset. Adapter credentials are optional here and are
 * demanded by the adapter that needs them, so modules that never call an API
 * run without any keys. Throws {@link ConfigError} listing every invalid
 * variable at once.
 */
export function loadConfig(env: EnvSource = process.env, options: LoadConfigOptions = {}): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => ({
        variable: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    );
  }
  const values = parsed.data;
  const cwd = options.cwd ?? process.cwd();
  return deepFreeze<Config>({
    digikey: {
      clientId: values.DIGIKEY_CLIENT_ID,
      clientSecret: values.DIGIKEY_CLIENT_SECRET,
      sandbox: values.DIGIKEY_SANDBOX,
      locale: {
        site: values.DIGIKEY_LOCALE_SITE,
        language: values.DIGIKEY_LOCALE_LANGUAGE,
        currency: values.DIGIKEY_LOCALE_CURRENCY,
      },
    },
    mouser: { apiKey: values.MOUSER_API_KEY },
    nexar: {
      clientId: values.NEXAR_CLIENT_ID,
      clientSecret: values.NEXAR_CLIENT_SECRET,
      enabled: values.NEXAR_ENABLED,
      budgetLimit: values.NEXAR_BUDGET_LIMIT,
    },
    anthropic: { apiKey: values.ANTHROPIC_API_KEY },
    agent: { model: values.AGENT_MODEL, effort: values.AGENT_EFFORT },
    dataDir: path.resolve(cwd, values.DATA_DIR),
    logLevel: values.LOG_LEVEL,
    liveTests: values.LIVE_TESTS,
  });
}
