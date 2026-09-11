import type { Escalation } from '../core/index.js';
import { normaliseMpn } from '../mpn/index.js';
import type { RunConfig } from './config.js';
import {
  contextFor,
  executeRun,
  type AgentRun,
  type Conclusion,
  type ConcludeInput,
  type RunnerDeps,
} from './execute.js';
import { runOutcomeOf } from './outcome.js';
import { extractionRequest, loadPrompt } from './prompt.js';

export interface Extraction {
  /** Questions this run raised, from any tool that raises them. */
  readonly escalations: readonly Escalation[];
}

export type ExtractionRun = AgentRun<Extraction>;

/**
 * Takes one part number through an extraction run.
 *
 * The run gets the whole tool surface as an in-process MCP server, no
 * built-in tools, a turn limit, a cost ceiling and the `PreToolUse` money
 * gate. What it achieved is read back from the ledger and the escalations,
 * not from what it says it did.
 *
 * Throws only when the run could not be set up — an unknown prompt version, a
 * part number that is not one, a context whose policy contradicts the run's.
 */
export async function extractPart(
  mpn: string,
  config: RunConfig,
  deps: RunnerDeps,
): Promise<ExtractionRun> {
  const prompt = await loadPrompt(config.promptVersion);
  const normalised = normaliseMpn(mpn).mpn;
  const context = contextFor(deps.context, config, prompt);

  return executeRun<Extraction>({
    kind: 'extract',
    mpn: normalised,
    config,
    prompt,
    request: extractionRequest(normalised),
    registry: deps.registry,
    context,
    deps,
    conclude: ({ ending, summary, startedAt }: ConcludeInput): Promise<Conclusion<Extraction>> => {
      const escalations = context.repositories.escalations
        .list({ mpn: normalised })
        .filter((escalation) => escalation.createdAt >= startedAt);
      const outcome = runOutcomeOf({
        ...ending,
        stored: summary.stored,
        escalations: escalations.length,
      });
      return Promise.resolve({
        result: outcome.result,
        reason: outcome.reason,
        escalations: escalations.length,
        stored: summary.stored,
        extra: { escalations },
      });
    },
  });
}
