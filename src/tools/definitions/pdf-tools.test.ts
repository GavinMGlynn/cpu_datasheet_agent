import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { bytesBody, onGet } from '../../../test/helpers/msw.js';
import { buildPdf, datasheetSpec } from '../../../test/helpers/pdf-fixtures.js';
import { createHarness, type TestHarness } from '../../../test/helpers/tool-context.js';
import { ValidationError } from '../../core/index.js';
import type { ToolRegistry } from '../registry.js';
import { buildRegistry } from './index.js';

const server = setupServer();
const URL = 'https://example.test/xyz54331.pdf';

let harness: TestHarness;
let registry: ToolRegistry;
let sha256: string;

async function call(name: string, input: unknown): Promise<Record<string, unknown>> {
  return (await registry.call(name, input, harness.context)) as Record<string, unknown>;
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterAll(() => {
  server.close();
});

beforeEach(async () => {
  server.resetHandlers();
  harness = await createHarness();
  registry = buildRegistry();
  ({ sha256 } = await harness.addDatasheet());
});

afterEach(async () => {
  await harness.close();
});

describe('fetch_datasheet', () => {
  async function servePdf(): Promise<void> {
    const bytes = await buildPdf(datasheetSpec());
    server.use(onGet(URL, () => bytesBody(bytes, { 'content-type': 'application/pdf' })));
  }

  it('downloads a datasheet, records it, and links the part number', async () => {
    await servePdf();

    const result = (await call('fetch_datasheet', { url: URL, mpn: 'XYZ54331DR' })) as {
      datasheet: { sha256: string; pageCount: number; coversMpns: string[] };
      hit: boolean;
    };

    expect(result.datasheet.pageCount).toBe(4);
    expect(result.datasheet.coversMpns).toEqual(['XYZ54331DR']);
    expect(result.hit).toBe(false);
    expect(harness.context.repositories.datasheets.getBySha(result.datasheet.sha256)).toBeDefined();
  });

  it('serves a repeat call from disk without downloading again', async () => {
    await servePdf();
    await call('fetch_datasheet', { url: URL });
    server.resetHandlers();

    expect((await call('fetch_datasheet', { url: URL })).hit).toBe(true);
  });

  it('rejects a URL that is not one', async () => {
    await expect(call('fetch_datasheet', { url: 'not-a-url' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('reports a response that is not a PDF', async () => {
    server.use(onGet(URL, () => bytesBody(Buffer.from('<html>nope</html>'), {})));
    await expect(call('fetch_datasheet', { url: URL })).rejects.toMatchObject({
      code: 'PDF_NOT_A_PDF',
    });
  });
});

describe('pdf_info', () => {
  it('reads the page count and title of a fetched datasheet', async () => {
    expect(await call('pdf_info', { sha256 })).toMatchObject({
      pageCount: 4,
      encrypted: false,
    });
  });

  it('names a digest nobody has fetched rather than failing on a missing file', async () => {
    await expect(call('pdf_info', { sha256: 'a'.repeat(64) })).rejects.toMatchObject({
      code: 'TOOL_NOT_FOUND',
    });
  });
});

describe('find_pages', () => {
  it('finds the ordering information pages', async () => {
    const result = (await call('find_pages', { sha256 })) as {
      sections: Record<string, { page: number; line: string }[]>;
    };
    expect(result.sections.orderingInformation?.[0]?.page).toBe(2);
    expect(Object.keys(result.sections).sort()).toEqual([
      'absoluteMaximumRatings',
      'electricalCharacteristics',
      'orderingInformation',
      'packageInformation',
      'pinConfiguration',
      'recommendedOperatingConditions',
    ]);
  });

  it('looks only for the sections asked for', async () => {
    const result = (await call('find_pages', { sha256, sections: ['orderingInformation'] })) as {
      sections: Record<string, unknown[]>;
    };
    expect(Object.keys(result.sections)).toEqual(['orderingInformation']);
  });

  it('rejects a section name it does not know', async () => {
    await expect(call('find_pages', { sha256, sections: ['pricing'] })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('read_pages', () => {
  it('returns the text of each page with metrics describing its shape', async () => {
    const result = (await call('read_pages', { sha256, pages: [1, 3] })) as {
      pages: { page: number; text: string; metrics: { suspectTable: boolean } }[];
    };

    expect(result.pages.map((page) => page.page)).toEqual([1, 3]);
    expect(result.pages[0]?.text).toContain('3.5 V to 28 V');
    // The cover reads as prose; the electrical characteristics page is a
    // table that lost its labels, which is what render_page exists for.
    expect(result.pages[0]?.metrics.suspectTable).toBe(false);
    expect(result.pages[1]?.metrics.suspectTable).toBe(true);
  });

  it('refuses a page the document does not have', async () => {
    await expect(call('read_pages', { sha256, pages: [99] })).rejects.toMatchObject({
      code: 'PDF_PAGE_OUT_OF_RANGE',
    });
  });

  it('rejects an empty page list', async () => {
    await expect(call('read_pages', { sha256, pages: [] })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('render_page', () => {
  it('returns the page as a PNG, and as an image block', async () => {
    const output = (await call('render_page', { sha256, page: 1, dpi: 72 })) as {
      page: number;
      dpi: number;
      base64: string;
      pngPath: string;
    };

    expect(output.dpi).toBe(72);
    expect(Buffer.from(output.base64, 'base64').subarray(1, 4).toString()).toBe('PNG');

    const blocks = registry.get('render_page').content?.(output);
    expect(blocks?.[0]).toEqual({ type: 'image', data: output.base64, mimeType: 'image/png' });
    expect(blocks?.[1]).toEqual({ type: 'text', text: 'page 1 at 72 dpi' });
  });

  it('rejects a resolution outside what pdftoppm is asked for', async () => {
    await expect(call('render_page', { sha256, page: 1, dpi: 20 })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
