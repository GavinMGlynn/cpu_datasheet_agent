import {
  PARAMETER_KEYS,
  type Escalation,
  type Part,
  type ParameterKey,
  type PartStatus,
  type Verification,
} from '../core/index.js';
import { normaliseMpn } from '../mpn/index.js';
import type { RunConfig } from './config.js';
import { AgentError } from './errors.js';
import {
  contextFor,
  executeRun,
  restrict,
  type AgentRun,
  type Conclusion,
  type ConcludeInput,
  type RunnerDeps,
} from './execute.js';
import { applyVerdicts } from './verdicts.js';
import { loadPrompt } from './prompt.js';

/**
 * The only tools a verification run gets.
 *
 * It reads pages and records verdicts. It cannot store a part, fetch
 * anything, ask a distributor, or raise a question directly: what happens to
 * the part is decided from the verdicts, deterministically, once the run has
 * ended.
 */
export const VERIFY_TOOLS: readonly string[] = Object.freeze([
  'read_pages',
  'render_page',
  'record_verification',
]);

export interface PageClaim {
  readonly page: number;
  readonly parameters: readonly { readonly key: ParameterKey; readonly value: unknown }[];
}

/** The stored values that cite this part's datasheet, grouped by the page each cites. */
export function claimsOf(part: Part): readonly PageClaim[] {
  const pages = new Map<number, { key: ParameterKey; value: unknown }[]>();
  for (const key of PARAMETER_KEYS) {
    const parameter = part.parameters[key];
    if (parameter.provenance.source !== 'datasheet') {
      continue;
    }
    const { page } = parameter.provenance;
    pages.set(page, [...(pages.get(page) ?? []), { key, value: parameter.value }]);
  }
  return [...pages.entries()]
    .sort(([one], [other]) => one - other)
    .map(([page, parameters]) => ({ page, parameters }));
}

/**
 * What the run is asked to check.
 *
 * The claims and the pages, and nothing else: not the extraction's quotes,
 * not its reasoning, not its transcript. A reader given the words the last
 * reader found will find them again.
 */
export function verificationRequest(part: Part, claims: readonly PageClaim[]): string {
  const datasheet = part.datasheet;
  const lines = claims.map((claim) => {
    const values = claim.parameters
      .map((parameter) => `- ${parameter.key}: ${JSON.stringify(parameter.value)}`)
      .join('\n');
    return `Page ${String(claim.page)}\n${values}`;
  });
  const pageCount = datasheet === undefined ? 'unknown' : String(datasheet.pageCount);
  const sha256 = datasheet === undefined ? 'unknown' : datasheet.sha256;
  return [
    `Check the stored values for ${part.mpn} against the pages they cite.`,
    `Datasheet ${sha256}, ${pageCount} pages.`,
    '',
    ...lines,
    '',
    'Record one verdict per parameter with record_verification.',
  ].join('\n');
}

export interface PartVerification {
  readonly verifications: readonly Verification[];
  /** The part as the verdicts left it. */
  readonly part: Part;
  readonly status: PartStatus;
  readonly escalations: readonly Escalation[];
  readonly confirmed: readonly ParameterKey[];
  readonly contradicted: readonly ParameterKey[];
  readonly notFound: readonly ParameterKey[];
  readonly unchecked: readonly ParameterKey[];
}

export type VerificationRun = AgentRun<PartVerification>;

function reasonFor(outcome: PartVerification, ending: { subtype: string }): string {
  const total =
    outcome.confirmed.length +
    outcome.contradicted.length +
    outcome.notFound.length +
    outcome.unchecked.length;
  const confirmed = `the pass confirmed ${String(outcome.confirmed.length)} of ${String(total)} values`;
  if (ending.subtype !== 'success') {
    return `${confirmed} before the run ended as ${ending.subtype}`;
  }
  const left: string[] = [];
  if (outcome.notFound.length > 0) {
    left.push(`${String(outcome.notFound.length)} not found on the page they cite`);
  }
  if (outcome.unchecked.length > 0) {
    left.push(`${String(outcome.unchecked.length)} left unchecked`);
  }
  return `${confirmed}: ${left.join(', ')}`;
}

/**
 * Checks every stored value of one part against the page it cites, in a
 * context that has never seen the extraction.
 *
 * The isolation is structural rather than a matter of prompt discipline: this
 * takes a part number, loads what was stored, and starts a new query. There is
 * no parameter through which an extraction transcript could reach it, and no
 * session is resumed.
 *
 * Throws when there is nothing to verify — no such part, or no value citing a
 * page — and records everything else as a run.
 */
export async function verifyPart(
  mpn: string,
  config: RunConfig,
  deps: RunnerDeps,
): Promise<VerificationRun> {
  const prompt = await loadPrompt(config.promptVersion);
  const normalised = normaliseMpn(mpn).mpn;
  const context = contextFor(deps.context, config, prompt);
  const part = context.repositories.parts.getPart(normalised);
  if (part === undefined) {
    throw new AgentError('PART_NOT_STORED', `no stored part ${normalised} to verify`, {
      details: { mpn: normalised },
    });
  }
  const claims = claimsOf(part);
  if (claims.length === 0) {
    throw new AgentError(
      'NOTHING_TO_VERIFY',
      `no value of ${normalised} cites a datasheet page, so there is nothing to check`,
      { details: { mpn: normalised } },
    );
  }

  return executeRun<PartVerification>({
    kind: 'verify',
    mpn: normalised,
    config,
    prompt,
    request: verificationRequest(part, claims),
    registry: restrict(deps.registry, VERIFY_TOOLS),
    context,
    deps,
    conclude: ({ ending, startedAt }: ConcludeInput): Promise<Conclusion<PartVerification>> => {
      const verdicts = new Map<ParameterKey, Verification>();
      for (const verification of context.repositories.verifications.list(normalised)) {
        if (verification.checkedAt >= startedAt && verification.promptVersion === prompt.version) {
          verdicts.set(verification.parameterKey, verification);
        }
      }
      const applied = applyVerdicts(part, verdicts, { now: context.now, newId: context.newId });
      if (applied.changed) {
        context.repositories.parts.upsertPart(applied.part);
      }
      for (const escalation of applied.escalations) {
        context.repositories.escalations.create(escalation);
      }
      const outcome: PartVerification = {
        verifications: [...verdicts.values()],
        part: applied.part,
        status: applied.part.status,
        escalations: applied.escalations,
        confirmed: applied.confirmed,
        contradicted: applied.contradicted,
        notFound: applied.notFound,
        unchecked: applied.unchecked,
      };
      const counts = {
        confirmed: applied.confirmed.length,
        contradicted: applied.contradicted.length,
        notFound: applied.notFound.length,
        unchecked: applied.unchecked.length,
      };
      const settled =
        ending.subtype === 'success' &&
        !ending.isError &&
        counts.contradicted === 0 &&
        counts.notFound === 0 &&
        counts.unchecked === 0;
      const result = settled
        ? 'verified'
        : applied.escalations.length > 0
          ? 'needs_human'
          : 'rejected';
      return Promise.resolve({
        result,
        ...(result === 'rejected' ? { reason: reasonFor(outcome, ending) } : {}),
        escalations: applied.escalations.length,
        stored: applied.changed,
        verdicts: counts,
        extra: outcome,
      });
    },
  });
}
