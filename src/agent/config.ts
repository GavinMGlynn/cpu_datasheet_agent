import { z } from 'zod';

import { AGENT_EFFORTS, type Config } from '../config.js';
import { PromptVersion } from '../core/index.js';
import { DEFAULT_QUOTA_POLICY, NO_SPEND_POLICY, type QuotaPolicy } from '../tools/index.js';

/** Turns a run is allowed before the harness stops it. */
export const DEFAULT_MAX_TURNS = 60;
/** What a run may cost before the harness stops it, in US dollars. */
export const DEFAULT_MAX_COST_USD = 2;
/** The prompt an extraction run is given unless told otherwise. */
export const DEFAULT_EXTRACT_PROMPT_VERSION = 'extract.v1';
/** The prompt a verification run is given unless told otherwise. */
export const DEFAULT_VERIFY_PROMPT_VERSION = 'verify.v1';

/**
 * Everything one run needs that is not the part number.
 *
 * The money gate is two of these fields: `allowSpend` decides both the quota
 * policy the tools enforce and what the run's `PreToolUse` hook does with a
 * spending call, and `maxCostUsd` is the ceiling the harness itself enforces
 * on the model calls. Neither is a default the agent can talk its way past.
 */
export const RunConfig = z.strictObject({
  model: z.string().trim().min(1).max(64),
  effort: z.enum(AGENT_EFFORTS),
  maxTurns: z.int().positive().max(500),
  maxCostUsd: z.number().positive().max(1000),
  promptVersion: PromptVersion,
  /** Whether the run may spend API quota or money at a distributor. */
  allowSpend: z.boolean(),
  /** The run's data directory: cache, database, ledger. */
  dataDir: z.string().min(1),
});
export type RunConfig = z.output<typeof RunConfig>;

/** The run configuration this environment implies, before any command line. */
export function defaultRunConfig(config: Config): RunConfig {
  return RunConfig.parse({
    model: config.agent.model,
    effort: config.agent.effort,
    maxTurns: DEFAULT_MAX_TURNS,
    maxCostUsd: DEFAULT_MAX_COST_USD,
    promptVersion: DEFAULT_EXTRACT_PROMPT_VERSION,
    allowSpend: false,
    dataDir: config.dataDir,
  });
}

/**
 * The quota policy the tools enforce for this run.
 *
 * The server-side flag protects against every client and the hook protects
 * against this agent; both read the same field, so a run cannot be allowed
 * to spend by one and refused by the other.
 */
export function policyFor(config: RunConfig): QuotaPolicy {
  return config.allowSpend ? DEFAULT_QUOTA_POLICY : NO_SPEND_POLICY;
}
