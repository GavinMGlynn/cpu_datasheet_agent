import { elementAt } from '../util/array.js';

/**
 * Deterministic shape measurements for one page of `pdftotext -layout` output.
 *
 * Dense electrical-characteristics tables mangle badly through text
 * extraction: values lose their row labels and columns merge. These numbers
 * let the agent decide, without judgement, when to render the page as an
 * image and read it visually instead.
 */
export interface PageMetrics {
  readonly lineCount: number;
  readonly nonEmptyLineCount: number;
  /** Cells on the busiest line, splitting on runs of two or more spaces. */
  readonly maxColumns: number;
  /** Median cell count across non-empty lines. */
  readonly medianColumns: number;
  /** Tokens that are a number, optionally signed, with an optional unit suffix. */
  readonly numericTokenCount: number;
  /** Non-empty lines holding numbers but no word of two or more letters. */
  readonly orphanNumericLineCount: number;
  /** Fraction of non-empty lines that are orphan numeric lines, 0 when the page is empty. */
  readonly orphanNumericRatio: number;
  /** True when the page looks like a table that lost its labels. See the module README. */
  readonly suspectTable: boolean;
}

const NUMERIC_TOKEN = /^[±+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[a-zA-ZµμΩΩ°%/]*$/;
const WORD = /[A-Za-z]{2,}/;

/** Cells on a line, splitting on runs of two or more spaces. */
export function splitCells(line: string): readonly string[] {
  return line
    .trim()
    .split(/ {2,}|\t+/)
    .filter((cell) => cell !== '');
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return elementAt(sorted, middle);
  }
  return (elementAt(sorted, middle - 1) + elementAt(sorted, middle)) / 2;
}

/** Measures one page of extracted text. Pure and stable for identical input. */
export function pageMetrics(text: string): PageMetrics {
  const lines = text.split('\n');
  const nonEmpty = lines.filter((line) => line.trim() !== '');
  const columnCounts = nonEmpty.map((line) => splitCells(line).length);

  let numericTokenCount = 0;
  let orphanNumericLineCount = 0;
  for (const line of nonEmpty) {
    const tokens = line.trim().split(/\s+/);
    const numeric = tokens.filter((token) => NUMERIC_TOKEN.test(token));
    numericTokenCount += numeric.length;
    if (numeric.length > 0 && !WORD.test(line)) {
      orphanNumericLineCount += 1;
    }
  }

  const orphanNumericRatio = nonEmpty.length === 0 ? 0 : orphanNumericLineCount / nonEmpty.length;
  const medianColumns = median(columnCounts);
  return {
    lineCount: lines.length,
    nonEmptyLineCount: nonEmpty.length,
    maxColumns: columnCounts.length === 0 ? 0 : Math.max(...columnCounts),
    medianColumns,
    numericTokenCount,
    orphanNumericLineCount,
    orphanNumericRatio,
    suspectTable:
      nonEmpty.length >= 3 &&
      numericTokenCount >= 6 &&
      (orphanNumericRatio >= 0.3 || medianColumns >= 4),
  };
}
