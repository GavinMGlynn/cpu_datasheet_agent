import { PARAMETER_KEYS } from '../core/parameter-keys.js';
import type { Part } from '../core/part.js';
import { citedPage } from './format.js';

/** The part of the PDF toolkit this needs, so a report can be tested without poppler. */
export interface PageRenderer {
  renderPage(
    ref: { readonly localPath: string; readonly sha256: string },
    page: number,
    dpi?: number,
  ): Promise<{ readonly bytes: Buffer }>;
}

export interface PageImageOptions {
  readonly dpi?: number;
  /** Skip a page whose image would exceed this many bytes. Default 4 MiB. */
  readonly maxBytesPerPage?: number;
}

export const DEFAULT_PAGE_IMAGE_DPI = 150;
export const DEFAULT_MAX_PAGE_IMAGE_BYTES = 4 * 1024 * 1024;

/** Every distinct page a datasheet-sourced parameter cites, in order. */
export function citedPages(part: Part): readonly number[] {
  const pages = new Set<number>();
  for (const key of PARAMETER_KEYS) {
    const page = citedPage(part.parameters[key].provenance);
    if (page !== undefined) {
      pages.add(page);
    }
  }
  return [...pages].sort((a, b) => a - b);
}

/**
 * Renders each cited page and returns it as a data URI, so the report is one
 * self-contained file that can be opened or shared without its images.
 *
 * A part with no datasheet has no cited pages and yields nothing. A page that
 * renders larger than the cap is skipped rather than bloating the report; the
 * parameters still appear in the table.
 */
export async function collectPageImages(
  part: Part,
  renderer: PageRenderer,
  options: PageImageOptions = {},
): Promise<ReadonlyMap<number, string>> {
  const images = new Map<number, string>();
  const datasheet = part.datasheet;
  if (datasheet === undefined) {
    return images;
  }
  const dpi = options.dpi ?? DEFAULT_PAGE_IMAGE_DPI;
  const maxBytes = options.maxBytesPerPage ?? DEFAULT_MAX_PAGE_IMAGE_BYTES;
  const ref = { localPath: datasheet.localPath, sha256: datasheet.sha256 };

  for (const page of citedPages(part)) {
    const { bytes } = await renderer.renderPage(ref, page, dpi);
    if (bytes.length <= maxBytes) {
      images.set(page, `data:image/png;base64,${bytes.toString('base64')}`);
    }
  }
  return images;
}
