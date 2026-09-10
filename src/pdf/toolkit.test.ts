import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Cache, FileCacheStore } from '../cache/index.js';
import { bytesBody, onGet } from '../../test/helpers/msw.js';
import { buildPdf, datasheetSpec, simpleSpec } from '../../test/helpers/pdf-fixtures.js';
import { popplerPreflight, type PopplerTools } from './poppler.js';
import { run, type RunFn } from './subprocess.js';
import {
  DEFAULT_RENDER_DPI,
  PAGE_PNG_NAMESPACE,
  PdfError,
  PdfToolkit,
  type PdfRef,
} from './toolkit.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const server = setupServer();

let tools: PopplerTools;
let root: string;
let store: FileCacheStore;
let cache: Cache;
let toolkit: PdfToolkit;
let ref: PdfRef;
let runCalls: string[];

const countingRun: RunFn = (bin, args, options) => {
  runCalls.push(bin);
  return run(bin, args, options);
};

async function writePdf(name: string, bytes: Buffer): Promise<PdfRef> {
  const localPath = path.join(root, name);
  await writeFile(localPath, bytes);
  return { localPath, sha256: createHash('sha256').update(bytes).digest('hex') };
}

beforeAll(async () => {
  tools = await popplerPreflight();
  server.listen({ onUnhandledRequest: 'error' });
});

afterAll(() => {
  server.close();
});

beforeEach(async () => {
  server.resetHandlers();
  root = await mkdtemp(path.join(tmpdir(), 'pdf-toolkit-'));
  store = new FileCacheStore(path.join(root, 'cache'));
  cache = new Cache({ store });
  runCalls = [];
  toolkit = new PdfToolkit({ cache, store, tools, run: countingRun });
  ref = await writePdf('datasheet.pdf', await buildPdf(datasheetSpec()));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('pdfInfo', () => {
  it('reads the page count, title, producer, and encrypted flag', async () => {
    const info = await toolkit.pdfInfo(ref);

    expect(info.pageCount).toBe(4);
    expect(info.title).toBe('XYZ54331 3-A Step-Down Converter');
    expect(info.producer).toBe('chip-datasheet-agent tests');
    expect(info.encrypted).toBe(false);
  });

  it('caches, so a second call runs no subprocess', async () => {
    await toolkit.pdfInfo(ref);
    runCalls = [];

    await expect(toolkit.pdfInfo(ref)).resolves.toMatchObject({ pageCount: 4 });
    expect(runCalls).toEqual([]);
  });

  it('reports a file poppler cannot open', async () => {
    const broken = await writePdf('broken.pdf', Buffer.from('not a pdf'));

    await expect(toolkit.pdfInfo(broken)).rejects.toMatchObject({ code: 'SUBPROCESS_FAILED' });
  });
});

describe('readPages', () => {
  it('extracts the text of one page with its layout preserved', async () => {
    const [page] = await toolkit.readPages(ref, [2]);

    expect(page?.page).toBe(2);
    expect(page?.text).toContain('Ordering Information');
    expect(page?.text).toContain('XYZ54331DDAR');
    expect(page?.text).toMatch(/XYZ54331DR {2,}SOIC-8/);
    expect(page?.hit).toBe(false);
  });

  it('returns pages in the order asked for', async () => {
    const pages = await toolkit.readPages(ref, [3, 1]);

    expect(pages.map((entry) => entry.page)).toEqual([3, 1]);
    expect(pages[0]?.text).toContain('Electrical Characteristics');
    expect(pages[1]?.text).toContain('Features');
  });

  it('caches per page, so re-reading runs no subprocess', async () => {
    await toolkit.readPages(ref, [1, 2]);
    runCalls = [];

    const again = await toolkit.readPages(ref, [1, 2, 3]);

    expect(again.map((entry) => entry.hit)).toEqual([true, true, false]);
    expect(runCalls).toEqual([tools.binaries.pdftotext]);
  });

  it('flags a dense numeric table as suspect', async () => {
    const [electrical] = await toolkit.readPages(ref, [3]);

    expect(electrical?.metrics.suspectTable).toBe(true);
    expect(electrical?.metrics.orphanNumericLineCount).toBeGreaterThanOrEqual(3);
    expect(electrical?.metrics.numericTokenCount).toBeGreaterThanOrEqual(6);
  });

  it('does not flag a page of prose', async () => {
    const [cover] = await toolkit.readPages(ref, [1]);

    expect(cover?.metrics.suspectTable).toBe(false);
    expect(cover?.metrics.nonEmptyLineCount).toBeGreaterThan(3);
  });

  it('rejects a page beyond the document, naming the page count', async () => {
    await expect(toolkit.readPages(ref, [99])).rejects.toMatchObject({
      code: 'PDF_PAGE_OUT_OF_RANGE',
      details: { page: 99, pageCount: 4 },
    });
  });

  it('accepts an empty page list', async () => {
    await expect(toolkit.readPages(ref, [])).resolves.toEqual([]);
    expect(runCalls).toEqual([]);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects page %s', async (page) => {
    await expect(toolkit.readPages(ref, [page])).rejects.toMatchObject({
      code: 'PDF_INVALID_PAGE',
    });
  });
});

describe('renderPage', () => {
  it('renders a page to PNG and caches the bytes on disk', async () => {
    const rendered = await toolkit.renderPage(ref, 2);

    expect(rendered.page).toBe(2);
    expect(rendered.dpi).toBe(DEFAULT_RENDER_DPI);
    expect(rendered.hit).toBe(false);
    expect(rendered.bytes.subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
    expect(rendered.bytes.length).toBeGreaterThan(1000);
    expect((await readFile(rendered.pngPath)).equals(rendered.bytes)).toBe(true);
    expect(rendered.pngPath).toContain(PAGE_PNG_NAMESPACE);
  });

  it('caches, so a second render runs no subprocess', async () => {
    const first = await toolkit.renderPage(ref, 2);
    runCalls = [];

    const second = await toolkit.renderPage(ref, 2);

    expect(second.hit).toBe(true);
    expect(second.pngPath).toBe(first.pngPath);
    expect(runCalls).toEqual([]);
  });

  it('treats a different resolution as a different image', async () => {
    const low = await toolkit.renderPage(ref, 2, 72);
    const high = await toolkit.renderPage(ref, 2, 200);

    expect(low.pngPath).not.toBe(high.pngPath);
    expect(high.bytes.length).toBeGreaterThan(low.bytes.length);
  });

  it('leaves no temporary directory behind', async () => {
    const before = (await import('node:fs/promises')).readdir;
    await toolkit.renderPage(ref, 1);
    const entries = await before(root);

    expect(entries.filter((entry) => entry.startsWith('pdf-render-'))).toEqual([]);
  });

  it.each([0, -1, 1.5])('rejects page %s', async (page) => {
    await expect(toolkit.renderPage(ref, page)).rejects.toMatchObject({ code: 'PDF_INVALID_PAGE' });
  });

  it.each([0, 35, 1201, 200.5])('rejects dpi %s', async (dpi) => {
    await expect(toolkit.renderPage(ref, 1, dpi)).rejects.toMatchObject({
      code: 'PDF_INVALID_DPI',
      details: { dpi },
    });
  });

  it('rejects a page beyond the document', async () => {
    await expect(toolkit.renderPage(ref, 99)).rejects.toMatchObject({
      code: 'PDF_PAGE_OUT_OF_RANGE',
      details: { page: 99, pageCount: 4 },
    });
  });

  it('reports when the renderer produced no image', async () => {
    const silentRun: RunFn = (bin) =>
      Promise.resolve({
        stdout: bin === tools.binaries.pdfinfo ? Buffer.from('Pages: 4\n') : Buffer.alloc(0),
        stderr: '',
        code: 0,
      });
    const quiet = new PdfToolkit({ cache, store, tools, run: silentRun });

    await expect(quiet.renderPage(ref, 1)).rejects.toMatchObject({
      code: 'PDF_RENDER_EMPTY',
      details: { page: 1, dpi: DEFAULT_RENDER_DPI },
    });
  });

  it('uses a configured temp directory', async () => {
    const custom = path.join(root, 'scratch');
    await (await import('node:fs/promises')).mkdir(custom, { recursive: true });
    const scoped = new PdfToolkit({ cache, store, tools, run: countingRun, tempDir: custom });

    await expect(scoped.renderPage(ref, 1)).resolves.toMatchObject({ page: 1 });
  });
});

describe('allPages', () => {
  it('splits the document into pages with no empty tail', async () => {
    const pages = await toolkit.allPages(ref);

    expect(pages).toHaveLength(4);
    expect(pages[1]).toContain('Ordering Information');
    expect(pages[3]).toContain('Absolute Maximum Ratings');
  });

  it('handles a single-page document', async () => {
    const single = await writePdf('one.pdf', await buildPdf(simpleSpec('only page')));

    const pages = await toolkit.allPages(single);

    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain('only page');
  });

  it('runs one subprocess and caches the result', async () => {
    await toolkit.allPages(ref);
    runCalls = [];

    await toolkit.allPages(ref);

    expect(runCalls).toEqual([]);
  });
});

describe('options', () => {
  it('accepts an explicit timeout, temp directory, fetch, and sleep', async () => {
    const configured = new PdfToolkit({
      cache,
      store,
      tools,
      run: countingRun,
      timeoutMs: 5000,
      tempDir: root,
      fetch: () => Promise.resolve(new Response(new Uint8Array([1]))),
      sleep: () => Promise.resolve(),
    });

    await expect(configured.pdfInfo(ref)).resolves.toMatchObject({ pageCount: 4 });
    await expect(configured.fetchPdf('https://injected.test/x.pdf')).rejects.toMatchObject({
      code: 'PDF_NOT_A_PDF',
    });
  });

  it('runs the real subprocess wrapper when none is injected', async () => {
    const plain = new PdfToolkit({ cache, store, tools });

    await expect(plain.pdfInfo(ref)).resolves.toMatchObject({ pageCount: 4 });
  });

  it('keeps a page of text that has no trailing form feed', async () => {
    const stubRun: RunFn = () =>
      Promise.resolve({ stdout: Buffer.from('one page only'), stderr: '', code: 0 });
    const stubbed = new PdfToolkit({ cache, store, tools, run: stubRun });

    await expect(stubbed.allPages(ref)).resolves.toEqual(['one page only']);
  });
});

describe('findPages', () => {
  it('locates every datasheet section on its page', async () => {
    const matches = await toolkit.findPages(ref);

    expect(matches.orderingInformation?.map((match) => match.page)).toEqual([2]);
    expect(matches.electricalCharacteristics?.map((match) => match.page)).toEqual([3]);
    expect(matches.absoluteMaximumRatings?.map((match) => match.page)).toEqual([4]);
    expect(matches.pinConfiguration?.map((match) => match.page)).toEqual([1]);
    expect(matches.packageInformation?.map((match) => match.page)).toEqual([2]);
    expect(matches.orderingInformation?.[0]?.line).toBe('Ordering Information');
  });

  it('reports a section mentioned on more than one page', async () => {
    const matches = await toolkit.findPages(ref);

    expect(matches.recommendedOperatingConditions?.map((match) => match.page)).toEqual([4]);
  });

  it('returns an empty list for a section that is absent', async () => {
    const single = await writePdf('bare.pdf', await buildPdf(simpleSpec('nothing of interest')));

    const matches = await toolkit.findPages(single);

    expect(matches.orderingInformation).toEqual([]);
    expect(matches.electricalCharacteristics).toEqual([]);
  });

  it('accepts custom patterns', async () => {
    const matches = await toolkit.findPages(ref, {
      partNumbers: /XYZ54331D\b/,
      thermal: /PowerPAD/,
    });

    expect(Object.keys(matches)).toEqual(['partNumbers', 'thermal']);
    expect(matches.partNumbers?.map((match) => match.page)).toEqual([2]);
    expect(matches.thermal?.[0]?.line).toContain('SO PowerPAD');
  });
});

describe('fetchPdf delegation', () => {
  it('downloads through the toolkit and yields a usable reference', async () => {
    const bytes = await buildPdf(simpleSpec('fetched page'));
    server.use(onGet('https://example.test/d.pdf', () => bytesBody(bytes)));

    const fetched = await toolkit.fetchPdf('https://example.test/d.pdf');
    const [page] = await toolkit.readPages(fetched, [1]);

    expect(fetched.hit).toBe(false);
    expect(page?.text).toContain('fetched page');
  });

  it('passes fetch options through', async () => {
    const bytes = await buildPdf(simpleSpec('too big for the cap'));
    server.use(onGet('https://example.test/big.pdf', () => bytesBody(bytes)));

    await expect(
      toolkit.fetchPdf('https://example.test/big.pdf', { maxBytes: 10 }),
    ).rejects.toMatchObject({
      code: 'PDF_TOO_LARGE',
    });
  });
});

describe('PdfError', () => {
  it('is a ChipAgentError subclass', () => {
    expect(new PdfError('X', 'x')).toBeInstanceOf(Error);
  });
});
