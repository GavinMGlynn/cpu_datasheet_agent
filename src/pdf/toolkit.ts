import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { bytesCodec, textCodec, type Cache } from '../cache/index.js';
import type { FileCacheStore } from '../cache/store.js';
import { ChipAgentError } from '../errors.js';
import { fetchPdf, type FetchPdfOptions, type FetchLike, type FetchedPdf } from './fetch-pdf.js';
import { pageMetrics, type PageMetrics } from './metrics.js';
import { parsePdfInfo, type PdfInfo } from './pdf-info.js';
import type { PopplerTools } from './poppler.js';
import { SECTION_PATTERNS, type SectionName } from './section-patterns.js';
import { run, type RunFn } from './subprocess.js';

export class PdfError extends ChipAgentError {}

/** A PDF already in the cache: where it is and what it hashes to. */
export interface PdfRef {
  readonly localPath: string;
  readonly sha256: string;
}

export interface PageText {
  readonly page: number;
  readonly text: string;
  readonly metrics: PageMetrics;
  /** True when the text came from the cache without running pdftotext. */
  readonly hit: boolean;
}

export interface RenderedPage {
  readonly page: number;
  readonly dpi: number;
  /** Path of the cached PNG on disk. */
  readonly pngPath: string;
  readonly bytes: Buffer;
  readonly hit: boolean;
}

export interface SectionMatch {
  readonly page: number;
  /** The matching line, trimmed. */
  readonly line: string;
}

export type SectionMatches = Readonly<Record<string, readonly SectionMatch[]>>;

export const TEXT_NAMESPACE = 'pdf_text';
export const PAGE_TEXT_NAMESPACE = 'pdf_page_text';
export const PAGE_PNG_NAMESPACE = 'pdf_page_png';
export const DEFAULT_RENDER_DPI = 200;

/** Bumped when extraction arguments change, so old cached text is not reused. */
export const EXTRACTION_VERSION = 1;

export interface PdfToolkitOptions {
  readonly cache: Cache;
  readonly store: FileCacheStore;
  readonly tools: PopplerTools;
  readonly run?: RunFn;
  readonly fetch?: FetchLike;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly timeoutMs?: number;
  /** Directory for pdftoppm output before it is cached. Defaults to the system temp directory. */
  readonly tempDir?: string;
}

function assertPage(page: number, what: string): void {
  if (!Number.isInteger(page) || page < 1) {
    throw new PdfError(
      'PDF_INVALID_PAGE',
      `${what} must be a positive integer, received ${String(page)}`,
      {
        details: { page },
      },
    );
  }
}

/**
 * Everything the agent needs from a datasheet PDF: fetch it, learn its shape,
 * read pages as text, render pages as images, and locate sections. Every
 * operation goes through the cache, so a rerun runs no subprocess and makes
 * no request.
 */
export class PdfToolkit {
  private readonly cache: Cache;
  private readonly store: FileCacheStore;
  private readonly tools: PopplerTools;
  private readonly runner: RunFn;
  private readonly timeoutMs: number;
  private readonly tempDir: string;

  constructor(private readonly options: PdfToolkitOptions) {
    this.cache = options.cache;
    this.store = options.store;
    this.tools = options.tools;
    this.runner = options.run ?? run;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.tempDir = options.tempDir ?? tmpdir();
  }

  /** Downloads a datasheet through the cache. See `fetchPdf`. */
  fetchPdf(url: string, options: FetchPdfOptions = {}): Promise<FetchedPdf> {
    return fetchPdf(
      {
        cache: this.cache,
        store: this.store,
        ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
        ...(this.options.sleep === undefined ? {} : { sleep: this.options.sleep }),
      },
      url,
      options,
    );
  }

  /** Page count, title, producer, and the encrypted flag, via `pdfinfo`. */
  async pdfInfo(ref: PdfRef): Promise<PdfInfo> {
    const result = await this.cache.cached(
      { namespace: 'pdf_info', params: { sha256: ref.sha256, version: EXTRACTION_VERSION } },
      async () => {
        const output = await this.runner(this.tools.binaries.pdfinfo, [ref.localPath], {
          timeoutMs: this.timeoutMs,
        });
        return { value: output.stdout.toString('utf8') };
      },
      { codec: textCodec },
    );
    return parsePdfInfo(result.value);
  }

  /**
   * Rejects a page the document does not have. `pdfinfo` exits non-zero for an
   * out-of-range page, so checking first turns an opaque subprocess failure
   * into a precise error naming the page count.
   */
  private async assertPageExists(ref: PdfRef, page: number): Promise<void> {
    const { pageCount } = await this.pdfInfo(ref);
    if (page > pageCount) {
      throw new PdfError(
        'PDF_PAGE_OUT_OF_RANGE',
        `page ${String(page)} is beyond the document's ${String(pageCount)} pages`,
        {
          details: { page, pageCount },
        },
      );
    }
  }

  /**
   * Text of the given pages through `pdftotext -layout`, one call per page,
   * cached per page. Each result carries shape metrics so the agent can tell
   * when a table has been mangled and should be read as an image instead.
   */
  async readPages(ref: PdfRef, pages: readonly number[]): Promise<readonly PageText[]> {
    const results: PageText[] = [];
    for (const page of pages) {
      assertPage(page, 'page');
      await this.assertPageExists(ref, page);
      const result = await this.cache.cached(
        {
          namespace: PAGE_TEXT_NAMESPACE,
          params: { sha256: ref.sha256, page, layout: true, version: EXTRACTION_VERSION },
        },
        async () => {
          const output = await this.runner(
            this.tools.binaries.pdftotext,
            [
              '-layout',
              '-enc',
              'UTF-8',
              '-f',
              String(page),
              '-l',
              String(page),
              ref.localPath,
              '-',
            ],
            { timeoutMs: this.timeoutMs },
          );
          return { value: output.stdout.toString('utf8') };
        },
        { codec: textCodec },
      );
      results.push({
        page,
        text: result.value,
        metrics: pageMetrics(result.value),
        hit: result.hit,
      });
    }
    return results;
  }

  /**
   * Renders one page to PNG with `pdftoppm`, cached by page and resolution.
   * Use when `readPages` reports `suspectTable`, or when a value is only
   * legible in the rendered page.
   */
  async renderPage(
    ref: PdfRef,
    page: number,
    dpi: number = DEFAULT_RENDER_DPI,
  ): Promise<RenderedPage> {
    assertPage(page, 'page');
    if (!Number.isInteger(dpi) || dpi < 36 || dpi > 1200) {
      throw new PdfError(
        'PDF_INVALID_DPI',
        `dpi must be an integer between 36 and 1200, received ${String(dpi)}`,
        {
          details: { dpi },
        },
      );
    }
    await this.assertPageExists(ref, page);
    const result = await this.cache.cached(
      {
        namespace: PAGE_PNG_NAMESPACE,
        params: { sha256: ref.sha256, page, dpi, version: EXTRACTION_VERSION },
      },
      async () => {
        const directory = await mkdtemp(path.join(this.tempDir, 'pdf-render-'));
        const prefix = path.join(directory, 'page');
        try {
          await this.runner(
            this.tools.binaries.pdftoppm,
            [
              '-png',
              '-r',
              String(dpi),
              '-f',
              String(page),
              '-l',
              String(page),
              '-singlefile',
              ref.localPath,
              prefix,
            ],
            { timeoutMs: this.timeoutMs },
          );
          let bytes: Buffer;
          try {
            bytes = await readFile(`${prefix}.png`);
          } catch (error) {
            throw new PdfError(
              'PDF_RENDER_EMPTY',
              `pdftoppm produced no image for page ${String(page)}`,
              {
                cause: error,
                details: { page, dpi },
              },
            );
          }
          return { value: bytes, contentType: 'image/png' };
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      },
      { codec: bytesCodec },
    );
    return {
      page,
      dpi,
      pngPath: this.store.dataPath({ namespace: PAGE_PNG_NAMESPACE, hash: result.hash }),
      bytes: result.value,
      hit: result.hit,
    };
  }

  /** Whole-document text, one `pdftotext` call, cached, split into pages on form feeds. */
  async allPages(ref: PdfRef): Promise<readonly string[]> {
    const result = await this.cache.cached(
      {
        namespace: TEXT_NAMESPACE,
        params: { sha256: ref.sha256, layout: true, version: EXTRACTION_VERSION },
      },
      async () => {
        const output = await this.runner(
          this.tools.binaries.pdftotext,
          ['-layout', '-enc', 'UTF-8', ref.localPath, '-'],
          { timeoutMs: this.timeoutMs },
        );
        return { value: output.stdout.toString('utf8') };
      },
      { codec: textCodec },
    );
    const pages = result.value.split('\f');
    // pdftotext ends the last page with a form feed, leaving an empty tail.
    if (pages.length > 1 && pages[pages.length - 1] === '') {
      pages.pop();
    }
    return pages;
  }

  /**
   * Finds the pages where each named section heading appears. Defaults to the
   * datasheet sections in `SECTION_PATTERNS`; pass your own patterns to look
   * for anything else. One datasheet often covers a whole family, so the
   * ordering-information pages matter as much as the electrical ones.
   */
  async findPages(
    ref: PdfRef,
    patterns: Readonly<Record<string, RegExp>> = SECTION_PATTERNS,
  ): Promise<SectionMatches> {
    const pages = await this.allPages(ref);
    const matches: Record<string, SectionMatch[]> = {};
    for (const name of Object.keys(patterns)) {
      matches[name] = [];
    }
    pages.forEach((text, index) => {
      const lines = text.split('\n');
      for (const [name, pattern] of Object.entries(patterns)) {
        const found = lines.find((line) => pattern.test(line));
        if (found !== undefined) {
          matches[name]?.push({ page: index + 1, line: found.trim() });
        }
      }
    });
    return matches;
  }
}

export type { SectionName };
