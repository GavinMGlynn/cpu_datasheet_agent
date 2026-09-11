/**
 * Prepares one part for hand characterisation (Module 13).
 *
 *   npx tsx scripts/prepare-golden.ts TPS54331DR
 *   npx tsx scripts/prepare-golden.ts TPS54331DR --url https://www.ti.com/lit/ds/symlink/tps54331.pdf
 *   npx tsx scripts/prepare-golden.ts TPS54331DR --pages 3,4,5 --render 5
 *   npx tsx scripts/prepare-golden.ts TPS54331DR --find "output voltage limit"
 *
 * Fetches the datasheet (through the cache, so a rerun downloads nothing),
 * records its digest and page count, finds the sections that hold the values,
 * and writes the text of the pages worth reading to
 * `eval/golden/work/<MPN>.md`. Rendered pages go beside it as PNGs.
 *
 * The working files are the manufacturer's copyright and are gitignored. What
 * gets committed is the golden JSON: the values, and the page each came from.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DigiKeyApi, DigiKeyClient, FileTokenStore } from '../src/adapters/digikey/index.js';
import { Cache, FileCacheStore } from '../src/cache/index.js';
import { loadConfig, loadEnvFileIfPresent } from '../src/config.js';
import { PdfToolkit, popplerPreflight, SECTION_PATTERNS } from '../src/pdf/index.js';

loadEnvFileIfPresent();
const config = loadConfig();

const args = process.argv.slice(2);
const given = args.shift();
if (given === undefined) {
  console.error('usage: prepare-golden <mpn> [--url <datasheet url>] [--pages 1,2] [--render 3]');
  process.exit(2);
}
const mpn: string = given;
/** A part number can hold a slash (Microchip's `MCP16331T-E/CH`); a file name cannot. */
const slug = mpn.replace(/[^A-Za-z0-9._-]/g, '_');

function option(name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

const store = new FileCacheStore(path.join(config.dataDir, 'cache'));
const cache = new Cache({ store });
const toolkit = new PdfToolkit({ cache, store, tools: await popplerPreflight() });

async function datasheetUrl(): Promise<string> {
  const given = option('--url');
  if (given !== undefined) {
    return given;
  }
  if (config.digikey.clientId === undefined || config.digikey.clientSecret === undefined) {
    throw new Error('no --url given and no Digi-Key credentials to ask');
  }
  const api = new DigiKeyApi({
    client: new DigiKeyClient({
      clientId: config.digikey.clientId,
      clientSecret: config.digikey.clientSecret,
      locale: config.digikey.locale,
      tokenStore: new FileTokenStore(path.join(config.dataDir, 'tokens', 'digikey.json')),
    }),
    cache,
    locale: config.digikey.locale,
  });
  const lookup = await api.lookup(mpn);
  if (lookup.datasheetUrl === undefined) {
    throw new Error(`Digi-Key lists no datasheet for ${mpn}`);
  }
  console.error(`${mpn}: ${lookup.manufacturer}, datasheet ${lookup.datasheetUrl}`);
  return lookup.datasheetUrl;
}

const url = await datasheetUrl();
const fetched = await toolkit.fetchPdf(url);
const ref = { localPath: fetched.localPath, sha256: fetched.sha256 };
const info = await toolkit.pdfInfo(ref);
const sections = await toolkit.findPages(ref, SECTION_PATTERNS);

const sectionPages = new Set<number>([1]);
for (const matches of Object.values(sections)) {
  for (const match of matches) {
    sectionPages.add(match.page);
    // The values usually continue onto the page after the heading.
    if (match.page < info.pageCount) {
      sectionPages.add(match.page + 1);
    }
  }
}
const chosen = option('--pages');
const pages =
  chosen === undefined
    ? [...sectionPages].sort((a, b) => a - b)
    : chosen.split(',').map((page) => Number(page.trim()));

const find = option('--find');
if (find !== undefined) {
  // Which page holds a phrase: the question asked constantly while reading a
  // datasheet by eye, and the one thing a section map does not answer.
  const pattern = new RegExp(find, 'i');
  const every = await toolkit.readPages(
    ref,
    Array.from({ length: info.pageCount }, (_, index) => index + 1),
  );
  for (const page of every) {
    const line = page.text.split('\n').find((candidate) => pattern.test(candidate));
    if (line !== undefined) {
      console.log(`page ${String(page.page)}: ${line.trim().slice(0, 120)}`);
    }
  }
  process.exit(0);
}

const texts = await toolkit.readPages(ref, pages);
const workDir = path.resolve('eval/golden/work');
await mkdir(workDir, { recursive: true });

const lines = [
  `# ${mpn}`,
  '',
  `- url: ${url}`,
  `- sha256: ${fetched.sha256}`,
  `- localPath: ${fetched.localPath}`,
  `- pageCount: ${String(info.pageCount)}`,
  `- title: ${info.title ?? '(none)'}`,
  '',
  '## Sections',
  '',
  ...Object.entries(sections).map(
    ([name, matches]) =>
      `- ${name}: ${matches.length === 0 ? '(not found)' : matches.map((match) => String(match.page)).join(', ')}`,
  ),
  '',
];
for (const page of texts) {
  lines.push(
    `## Page ${String(page.page)}${page.metrics.suspectTable ? ' (suspect table: read the rendered page)' : ''}`,
    '',
    '```',
    page.text,
    '```',
    '',
  );
}
const workFile = path.join(workDir, `${slug}.md`);
await writeFile(workFile, lines.join('\n'), 'utf8');
console.error(`wrote ${workFile} (${String(pages.length)} pages)`);

const render = option('--render');
if (render !== undefined) {
  for (const page of render.split(',').map((value) => Number(value.trim()))) {
    const rendered = await toolkit.renderPage(ref, page, 150);
    const target = path.join(workDir, `${slug}-p${String(page)}.png`);
    await writeFile(target, rendered.bytes);
    console.error(`wrote ${target}`);
  }
}
