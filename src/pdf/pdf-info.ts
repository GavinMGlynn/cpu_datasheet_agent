import { ChipAgentError } from '../errors.js';
import { group } from '../util/regex.js';

export class PdfInfoError extends ChipAgentError {}

export interface PdfInfo {
  readonly pageCount: number;
  readonly title: string | undefined;
  readonly producer: string | undefined;
  readonly encrypted: boolean;
}

const PAGES = /^Pages:\s+(\d+)$/m;

function field(text: string, name: string): string | undefined {
  // Horizontal whitespace only: `\s` would let an empty field swallow the next line.
  const match = new RegExp(`^${name}:[^\\S\\r\\n]*(.*)$`, 'm').exec(text);
  if (match === null) {
    return undefined;
  }
  const value = group(match, 1).trim();
  return value === '' ? undefined : value;
}

/** Parses `pdfinfo` output. Throws `PDF_INFO_UNPARSEABLE` when the page count is absent. */
export function parsePdfInfo(text: string): PdfInfo {
  const pages = PAGES.exec(text);
  if (pages === null) {
    throw new PdfInfoError('PDF_INFO_UNPARSEABLE', 'pdfinfo output has no page count', {
      details: { output: text.slice(0, 500) },
    });
  }
  const encrypted = field(text, 'Encrypted');
  return {
    pageCount: Number(group(pages, 1)),
    title: field(text, 'Title'),
    producer: field(text, 'Producer'),
    encrypted: encrypted !== undefined && !encrypted.startsWith('no'),
  };
}
