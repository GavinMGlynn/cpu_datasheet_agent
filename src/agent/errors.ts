import { ChipAgentError } from '../errors.js';

/**
 * A run could not be set up or could not be asked for.
 *
 * A run that fails is not one of these: a model that ran out of turns or a
 * harness that crashed is an ending, recorded as a rejected run. These are
 * the mistakes that stop a run from starting at all.
 */
export class AgentError extends ChipAgentError {}

/** The message a person should see for a thrown value. */
export function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
