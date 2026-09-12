import { access, constants } from 'node:fs/promises';

import { z } from 'zod';

import type { Datasheet } from '../../core/datasheet.js';
import { parseOrThrow } from '../../core/validation-error.js';
import { Sha256 } from '../../core/primitives.js';
import { DEFAULT_RENDER_DPI, type PdfRef } from '../../pdf/toolkit.js';
import { required } from '../../util/present.js';
import type { OpenSource } from '../data/sources.js';
import type { RouteEntry } from '../server/app.js';
import { WebError } from '../server/errors.js';
import type { Router } from '../server/router.js';
import { openSource, read, type ApiDeps } from './deps.js';
import { IntParam, parseQuery } from './params.js';

/**
 * The datasheet endpoints.
 *
 * One datasheet commonly covers a whole family, so these are addressed by
 * digest rather than by part number, and every response says which part
 * numbers the ordering table lists. Page text and page images come from the
 * same toolkit the agent reads with, through the same cache: what the site
 * shows is what the extraction saw.
 */

function refOf(datasheet: Datasheet): PdfRef {
  return { localPath: datasheet.localPath, sha256: datasheet.sha256 };
}

function requireDatasheet(opened: OpenSource, sha256: string): Datasheet {
  const digest = parseOrThrow(Sha256, sha256, 'the datasheet digest');
  const datasheet = opened.repositories.datasheets.getBySha(digest);
  if (datasheet === undefined) {
    throw new WebError(404, 'WEB_DATASHEET_NOT_FOUND', `no datasheet with digest ${digest}`, {
      details: { sha256: digest },
    });
  }
  return datasheet;
}

function pageOf(datasheet: Datasheet, raw: string | undefined): number {
  const page = parseOrThrow(IntParam.pipe(z.number().min(1)), raw, 'the page number');
  if (page > datasheet.pageCount) {
    throw new WebError(
      404,
      'WEB_PAGE_NOT_IN_DATASHEET',
      `this datasheet has ${String(datasheet.pageCount)} pages`,
      { details: { page, pageCount: datasheet.pageCount } },
    );
  }
  return page;
}

/**
 * Checks the PDF is still where the database says before poppler is asked to
 * read it.
 *
 * A row can outlive its file — a cache cleared, a data directory moved — and
 * the difference between "gone" and "broken" matters to whoever is reading
 * the page. Poppler's own failure for a missing file is an exit code, which
 * would arrive here as an internal error and say nothing useful.
 */
function requirePoppler(deps: ApiDeps): void {
  if (deps.poppler === undefined) {
    throw new WebError(
      503,
      'WEB_POPPLER_MISSING',
      'this machine has no poppler, so datasheet pages cannot be read or rendered',
    );
  }
}

async function requireFile(datasheet: Datasheet): Promise<Datasheet> {
  try {
    await access(datasheet.localPath, constants.R_OK);
  } catch (error) {
    throw new WebError(
      410,
      'WEB_DATASHEET_FILE_MISSING',
      `the PDF for ${datasheet.sha256} is recorded but not readable at ${datasheet.localPath}`,
      { cause: error, details: { sha256: datasheet.sha256 } },
    );
  }
  return datasheet;
}

export function registerDatasheets(router: Router<RouteEntry>, deps: ApiDeps): void {
  router.get(
    '/api/datasheets',
    read(async (context) => {
      const opened = await openSource(context, deps);
      const datasheets = opened.repositories.datasheets.list();
      context.respond.json(context.response, context.facts, {
        source: opened.source.id,
        datasheets: datasheets.map((datasheet) => ({
          ...datasheet,
          parts: opened.repositories.datasheets.mpnsCoveredBy(datasheet.sha256),
        })),
      });
    }),
  );

  router.get(
    '/api/datasheets/:sha256',
    read(async (context) => {
      const opened = await openSource(context, deps);
      const datasheet = requireDatasheet(opened, required(context.params.sha256, 'a digest'));
      context.respond.json(context.response, context.facts, {
        datasheet,
        parts: opened.repositories.datasheets.mpnsCoveredBy(datasheet.sha256),
      });
    }),
  );

  router.get(
    '/api/datasheets/:sha256/pages/:page',
    read(async (context) => {
      const opened = await openSource(context, deps);
      const datasheet = requireDatasheet(opened, required(context.params.sha256, 'a digest'));
      const page = pageOf(datasheet, context.params.page);
      requirePoppler(deps);
      await requireFile(datasheet);
      const pages = await deps.pdf.readPages(refOf(datasheet), [page]);
      context.respond.json(context.response, context.facts, {
        sha256: datasheet.sha256,
        page: required(pages[0], 'the page just read'),
      });
    }),
  );

  const ImageQuery = z.strictObject({
    source: z.string().min(1).max(128).default('live'),
    dpi: IntParam.pipe(z.number().min(36).max(1200)).default(DEFAULT_RENDER_DPI),
  });

  router.get(
    '/api/datasheets/:sha256/pages/:page/image',
    read(async (context) => {
      const query = parseQuery(ImageQuery, context.query);
      const opened = await deps.sources.open(query.source);
      const datasheet = requireDatasheet(opened, required(context.params.sha256, 'a digest'));
      const page = pageOf(datasheet, context.params.page);
      requirePoppler(deps);
      await requireFile(datasheet);
      const rendered = await deps.pdf.renderPage(refOf(datasheet), page, query.dpi);
      context.respond.bytes(context.response, context.facts, rendered.bytes, 'image/png', {
        policy: 'derived',
        headers: { 'X-Page': String(page), 'X-Dpi': String(rendered.dpi) },
      });
    }),
  );

  const SearchQuery = z.strictObject({
    source: z.string().min(1).max(128).default('live'),
    q: z.string().min(2).max(120),
  });

  router.get(
    '/api/datasheets/:sha256/search',
    read(async (context) => {
      const query = parseQuery(SearchQuery, context.query);
      const opened = await deps.sources.open(query.source);
      const datasheet = requireDatasheet(opened, required(context.params.sha256, 'a digest'));
      requirePoppler(deps);
      await requireFile(datasheet);
      const pages = await deps.pdf.allPages(refOf(datasheet));
      const needle = query.q.toLowerCase();
      const matches = pages.flatMap((text, index) =>
        text
          .split('\n')
          .filter((line) => line.toLowerCase().includes(needle))
          .map((line) => ({ page: index + 1, line: line.trim() })),
      );
      context.respond.json(context.response, context.facts, {
        sha256: datasheet.sha256,
        query: query.q,
        matches,
      });
    }),
  );

  router.get(
    '/api/datasheets/:sha256/sections',
    read(async (context) => {
      const opened = await openSource(context, deps);
      const datasheet = requireDatasheet(opened, required(context.params.sha256, 'a digest'));
      requirePoppler(deps);
      await requireFile(datasheet);
      const sections = await deps.pdf.findPages(refOf(datasheet));
      context.respond.json(context.response, context.facts, {
        sha256: datasheet.sha256,
        sections,
      });
    }),
  );
}
