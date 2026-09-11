import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { Iso8601, ParameterKey, Run, parseOrThrow } from '../core/index.js';
import { required } from '../util/present.js';
import { AGENT_EFFORTS } from '../config.js';
import { PAGE_SCORES, SCORES } from './scorer.js';
import type { EvalResult } from './harness.js';

/** Where results are written, relative to the repository root. */
export const RESULTS_DIR = 'eval/results';
export const REPORT_FILE = 'result.json';
export const SUMMARY_FILE = 'summary.md';

const ParameterScoreSchema = z.strictObject({
  key: ParameterKey,
  score: z.enum(SCORES),
  page: z.enum(PAGE_SCORES),
  /** Absent when the side in question stated nothing at all. */
  expected: z.json().optional(),
  actual: z.json().optional(),
});

const PartScoreSchema = z.strictObject({
  mpn: z.string(),
  parameters: z.array(ParameterScoreSchema),
  recall: z.number(),
  precision: z.number(),
  provenanceAccuracy: z.number(),
});

const PartResultSchema = z.strictObject({
  mpn: z.string(),
  run: Run,
  score: PartScoreSchema,
  cacheMisses: z.int().nonnegative(),
});

/**
 * A result as it is written to disk.
 *
 * The per-part scores live at the top level, so the totals carry only the
 * totals: the same numbers twice in one file is one of them going stale.
 */
export const EvalReport = z.strictObject({
  startedAt: Iso8601,
  endedAt: Iso8601,
  promptVersion: z.string(),
  model: z.string(),
  effort: z.enum(AGENT_EFFORTS),
  parts: z.array(PartResultSchema),
  set: z.strictObject({
    recall: z.number(),
    precision: z.number(),
    provenanceAccuracy: z.number(),
    withinOnePage: z.number(),
    byParameter: z.record(
      ParameterKey,
      z.strictObject({ correct: z.int().nonnegative(), stated: z.int().nonnegative() }),
    ),
  }),
  turns: z.int().nonnegative(),
  costUsd: z.number().nonnegative(),
  starved: z.array(z.string()),
});
export type EvalReport = z.output<typeof EvalReport>;

/** A file name that sorts by time and says what produced it. */
export function resultDirName(
  result: Pick<EvalResult, 'startedAt' | 'promptVersion' | 'model'>,
): string {
  const stamp = result.startedAt.replace(/[:.]/g, '-');
  return `${stamp}-${result.promptVersion}-${result.model}`;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** The report as a person reads it. */
export function renderMarkdown(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(`# Evaluation ${report.promptVersion} / ${report.model}`);
  lines.push('');
  lines.push(`- Prompt: \`${report.promptVersion}\``);
  lines.push(`- Model: \`${report.model}\` at effort \`${report.effort}\``);
  lines.push(`- Started: ${report.startedAt}`);
  lines.push(`- Parts: ${String(report.parts.length)}`);
  lines.push(`- Cost: ${money(report.costUsd)} over ${String(report.turns)} turns`);
  lines.push('');
  lines.push('## Totals');
  lines.push('');
  lines.push('| Measure | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Recall | ${percent(report.set.recall)} |`);
  lines.push(`| Precision | ${percent(report.set.precision)} |`);
  lines.push(`| Citations exact | ${percent(report.set.provenanceAccuracy)} |`);
  lines.push(`| Citations one page out | ${percent(report.set.withinOnePage)} |`);
  lines.push('');
  if (report.starved.length > 0) {
    lines.push(
      `**${String(report.starved.length)} part(s) wanted something the cache did not have:** ${report.starved.join(', ')}. Their scores measure the cache, not the prompt.`,
    );
    lines.push('');
  }
  lines.push('## Parts');
  lines.push('');
  lines.push('| Part | Result | Recall | Precision | Citations | Turns | Cost |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const part of report.parts) {
    // Every run in a report has ended; the schema still types the fields an
    // ending brings as optional, and a fallback for a state that cannot
    // happen would be a fallback nobody could test (D23).
    const where = `the run recorded for ${part.mpn}`;
    lines.push(
      `| ${part.mpn} | ${required(part.run.result, where)} | ${percent(part.score.recall)} | ${percent(
        part.score.precision,
      )} | ${percent(part.score.provenanceAccuracy)} | ${String(required(part.run.turns, where))} | ${money(
        required(part.run.costUsd, where),
      )} |`,
    );
  }
  lines.push('');
  lines.push('## Parameters');
  lines.push('');
  lines.push('| Parameter | Correct | Stated |');
  lines.push('| --- | --- | --- |');
  for (const [key, counts] of Object.entries(report.set.byParameter)) {
    lines.push(`| ${key} | ${String(counts.correct)} | ${String(counts.stated)} |`);
  }
  lines.push('');
  const wrong = report.parts.flatMap((part) =>
    part.score.parameters
      .filter((one) => one.score === 'wrong' || one.score === 'extra')
      .map((one) => ({ mpn: part.mpn, one })),
  );
  lines.push('## Every value that was wrong');
  lines.push('');
  if (wrong.length === 0) {
    lines.push('None.');
  } else {
    lines.push('| Part | Parameter | Score | Golden | Extracted |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const { mpn, one } of wrong) {
      const both = `both values of ${mpn} ${one.key}`;
      lines.push(
        `| ${mpn} | ${one.key} | ${one.score} | \`${JSON.stringify(required(one.expected, both))}\` | \`${JSON.stringify(required(one.actual, both))}\` |`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

/** Drops the part scores the totals repeat, so the file states each number once. */
export function toReport(result: EvalResult): EvalReport {
  const { parts: _parts, ...totals } = result.set;
  return parseOrThrow(
    EvalReport,
    JSON.parse(
      JSON.stringify({
        startedAt: result.startedAt,
        endedAt: result.endedAt,
        promptVersion: result.promptVersion,
        model: result.model,
        effort: result.effort,
        parts: result.parts,
        set: totals,
        turns: result.turns,
        costUsd: result.costUsd,
        starved: result.starved,
      }),
    ),
    'EvalReport',
  );
}

/** Writes `result.json` and `summary.md`, and returns the directory holding them. */
export async function writeReport(report: EvalReport, root = RESULTS_DIR): Promise<string> {
  const dir = path.join(root, resultDirName(report));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, REPORT_FILE), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(path.join(dir, SUMMARY_FILE), renderMarkdown(report), 'utf8');
  return dir;
}

/** Reads a written report back, validated. */
export async function readReport(dir: string): Promise<EvalReport> {
  const text = await readFile(path.join(dir, REPORT_FILE), 'utf8');
  return parseOrThrow(EvalReport, JSON.parse(text), `report in ${dir}`);
}
