/**
 * Renders a stored part as a standalone HTML report.
 *
 *   npx tsx scripts/render-part-report.ts TPS54331DR
 *   npx tsx scripts/render-part-report.ts TPS54331DR --out report.html --quantity 100
 *   npx tsx scripts/render-part-report.ts TPS54331DR --no-pages
 *
 * Cited datasheet pages are rendered and embedded, so the report is one file
 * that can be opened or shared on its own. That needs poppler and the cached
 * PDF; pass --no-pages to skip it.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Cache, FileCacheStore } from '../src/cache/index.js';
import { loadConfig } from '../src/config.js';
import { createRepositories, openDatabase } from '../src/db/index.js';
import { PdfToolkit, popplerPreflight } from '../src/pdf/index.js';
import { collectPageImages, renderPartReport } from '../src/report/index.js';

process.loadEnvFile('.env');
const config = loadConfig();

const args = process.argv.slice(2);
const mpn = args.find((arg) => !arg.startsWith('--'));
if (mpn === undefined) {
  console.error('usage: render-part-report <mpn> [--out file.html] [--quantity n] [--no-pages]');
  process.exit(2);
}
const outIndex = args.indexOf('--out');
const out = outIndex === -1 ? `${mpn}.report.html` : (args[outIndex + 1] ?? `${mpn}.report.html`);
const quantityIndex = args.indexOf('--quantity');
const quantity = quantityIndex === -1 ? 1 : Number(args[quantityIndex + 1] ?? '1');
const withPages = !args.includes('--no-pages');

const db = openDatabase(path.join(config.dataDir, 'chip.sqlite'));
const part = createRepositories(db).parts.getPart(mpn);
if (part === undefined) {
  console.error(`no part stored for ${mpn}. Run an extraction first.`);
  process.exit(1);
}

let pageImages;
if (withPages && part.datasheet !== undefined) {
  const store = new FileCacheStore(path.join(config.dataDir, 'cache'));
  const toolkit = new PdfToolkit({
    cache: new Cache({ store }),
    store,
    tools: await popplerPreflight(),
  });
  pageImages = await collectPageImages(part, toolkit);
}

await writeFile(
  out,
  renderPartReport(part, { quantity, ...(pageImages === undefined ? {} : { pageImages }) }),
  'utf8',
);
db.close();
console.error(`wrote ${out}`);
