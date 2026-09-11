import { z } from 'zod';

import { Datasheet, NormalisedMpn, Sha256, Url } from '../../core/index.js';
import { SECTION_NAMES, SECTION_PATTERNS, type PdfRef, type SectionName } from '../../pdf/index.js';
import { ToolError } from '../errors.js';
import { defineTool } from '../registry.js';
import { PageTextSchema, PdfInfoSchema, SectionMatchSchema } from '../schemas.js';
import type { ContentBlock, ToolContext, ToolDefinition } from '../types.js';

/**
 * The local copy of a datasheet by digest.
 *
 * A digest nobody has fetched is not an error the agent can fix by trying
 * harder, so it is named as such rather than reported as a missing file.
 */
function refFor(context: ToolContext, sha256: string): PdfRef {
  const datasheet = context.repositories.datasheets.getBySha(sha256);
  if (datasheet === undefined) {
    throw new ToolError(
      'TOOL_NOT_FOUND',
      `no datasheet with digest ${sha256} has been fetched; call fetch_datasheet first`,
      { details: { sha256 } },
    );
  }
  return { localPath: datasheet.localPath, sha256: datasheet.sha256 };
}

export const fetchDatasheet = defineTool({
  name: 'fetch_datasheet',
  description:
    'Download a datasheet PDF and record it by digest. Repeat calls for the same URL are served from disk. One datasheet usually covers a whole family, so the part number given is linked to it rather than owning it.',
  input: z.strictObject({
    url: Url,
    /** Link this part number to the datasheet. */
    mpn: NormalisedMpn.optional(),
  }),
  output: z.strictObject({
    datasheet: Datasheet,
    /** True when the file was already on disk, so nothing was downloaded. */
    hit: z.boolean(),
  }),
  // Downloading a manufacturer's PDF costs nothing and buys everything the
  // extraction reads, so it is not gated; the distributor APIs are. The
  // fetcher's own retry and size limits are what keep it polite.
  spendsQuota: false,
  annotations: { readOnlyHint: false, destructiveHint: false },
  handler: async (input, context) => {
    const fetched = await context.toolkit.fetchPdf(input.url);
    const ref = { localPath: fetched.localPath, sha256: fetched.sha256 };
    const info = await context.toolkit.pdfInfo(ref);
    const datasheet = context.repositories.datasheets.record({
      url: input.url,
      sha256: fetched.sha256,
      pageCount: info.pageCount,
      fetchedAt: context.now(),
      localPath: fetched.localPath,
      coversMpns: input.mpn === undefined ? [] : [input.mpn],
    });
    return { datasheet, hit: fetched.hit };
  },
});

export const pdfInfo = defineTool({
  name: 'pdf_info',
  description: 'Page count, title, producer, and whether a fetched datasheet is encrypted.',
  input: z.strictObject({ sha256: Sha256 }),
  output: PdfInfoSchema,
  annotations: { readOnlyHint: true, destructiveHint: false },
  handler: (input, context) => context.toolkit.pdfInfo(refFor(context, input.sha256)),
});

export const findPages = defineTool({
  name: 'find_pages',
  description:
    'Pages where each datasheet section heading appears: ordering information, electrical characteristics, absolute maximum ratings, recommended operating conditions, pin configuration, package information.',
  input: z.strictObject({
    sha256: Sha256,
    /** Defaults to every known section. */
    sections: z.array(z.enum(SECTION_NAMES)).min(1).optional(),
  }),
  output: z.strictObject({
    sections: z.record(z.string(), z.array(SectionMatchSchema)),
  }),
  annotations: { readOnlyHint: true, destructiveHint: false },
  handler: async (input, context) => {
    const wanted: SectionName[] = [...(input.sections ?? SECTION_NAMES)];
    const patterns = Object.fromEntries(wanted.map((name) => [name, SECTION_PATTERNS[name]]));
    const found = await context.toolkit.findPages(refFor(context, input.sha256), patterns);
    return {
      sections: Object.fromEntries(
        Object.entries(found).map(([section, matches]) => [section, [...matches]]),
      ),
    };
  },
});

export const readPages = defineTool({
  name: 'read_pages',
  description:
    'Text of the named pages, with metrics describing the shape of each. A page whose metrics say `suspectTable` has lost its column structure in extraction and should be read with render_page instead.',
  input: z.strictObject({
    sha256: Sha256,
    pages: z.array(z.int().positive()).min(1).max(40),
  }),
  output: z.strictObject({ pages: z.array(PageTextSchema) }),
  annotations: { readOnlyHint: true, destructiveHint: false },
  handler: async (input, context) => ({
    pages: [...(await context.toolkit.readPages(refFor(context, input.sha256), input.pages))],
  }),
});

export const renderPage = defineTool({
  name: 'render_page',
  description:
    'Render one datasheet page to a PNG image and return it, for a table that text extraction mangles.',
  input: z.strictObject({
    sha256: Sha256,
    page: z.int().positive(),
    dpi: z.int().min(36).max(1200).optional(),
  }),
  output: z.strictObject({
    page: z.int().positive(),
    dpi: z.int(),
    pngPath: z.string(),
    /** The PNG itself, base64, so a client that cannot read the path still has it. */
    base64: z.string(),
    hit: z.boolean(),
  }),
  annotations: { readOnlyHint: true, destructiveHint: false },
  handler: async (input, context) => {
    const rendered = await context.toolkit.renderPage(
      refFor(context, input.sha256),
      input.page,
      input.dpi,
    );
    return {
      page: rendered.page,
      dpi: rendered.dpi,
      pngPath: rendered.pngPath,
      base64: rendered.bytes.toString('base64'),
      hit: rendered.hit,
    };
  },
  // The page is returned as an image block: a model that can see the page is
  // the reason this tool exists, and a base64 string in a JSON blob is not
  // that.
  content: (output): readonly ContentBlock[] => [
    { type: 'image', data: output.base64, mimeType: 'image/png' },
    {
      type: 'text',
      text: `page ${String(output.page)} at ${String(output.dpi)} dpi`,
    },
  ],
});

export const PDF_TOOLS: readonly ToolDefinition[] = [
  fetchDatasheet,
  pdfInfo,
  findPages,
  readPages,
  renderPage,
];
