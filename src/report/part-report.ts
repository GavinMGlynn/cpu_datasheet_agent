import { PARAMETER_KEYS, type ParameterKey } from '../core/parameter-keys.js';
import { selectBestPrice, type Offer } from '../core/offer.js';
import type { Part } from '../core/part.js';
import { escapeHtml } from './escape.js';
import {
  NOT_STATED,
  citedPage,
  citedQuote,
  formatParameterValue,
  formatPrice,
  formatProvenance,
} from './format.js';
import { REPORT_STYLE } from './style.js';

export interface PartReportOptions {
  /**
   * Rendered pages by page number, as anything an `img` can load: a data URI,
   * or a path relative to where the report is written. Supplying them turns on
   * the section that puts each cited page beside the values taken from it,
   * which is the whole point of reading a report rather than a table.
   */
  readonly pageImages?: ReadonlyMap<number, string>;
  /** Quantity used for the price summary. Default 1. */
  readonly quantity?: number;
  /** Shown in the footer. Defaults to now. */
  readonly generatedAt?: string;
}

interface ParameterRow {
  readonly key: ParameterKey;
  readonly value: string;
  readonly provenance: string;
  readonly confidence: string;
  readonly page: number | undefined;
  readonly quote: string | undefined;
}

function rowsOf(part: Part): readonly ParameterRow[] {
  return PARAMETER_KEYS.map((key) => {
    const parameter = part.parameters[key];
    return {
      key,
      value: formatParameterValue(parameter.value),
      provenance: formatProvenance(parameter.provenance),
      confidence: parameter.confidence,
      page: citedPage(parameter.provenance),
      quote: citedQuote(parameter.provenance),
    };
  });
}

function tag(name: string, className: string, text: string): string {
  return `<${name} class="${className}">${escapeHtml(text)}</${name}>`;
}

function parameterTable(rows: readonly ParameterRow[]): string {
  const body = rows
    .map((row) => {
      const quote =
        row.quote === undefined ? '' : `<div class="quote">${escapeHtml(row.quote)}</div>`;
      const notStated = row.value === NOT_STATED ? ' class="muted"' : '';
      return `<tr>
  <th scope="row"><code>${escapeHtml(row.key)}</code></th>
  <td${notStated}>${escapeHtml(row.value)}</td>
  <td>${escapeHtml(row.provenance)}${quote}</td>
  <td>${tag('span', `badge ${row.confidence}`, row.confidence)}</td>
</tr>`;
    })
    .join('\n');
  return `<table class="parameters">
<caption>Parameters</caption>
<thead><tr><th scope="col">Parameter</th><th scope="col">Value</th><th scope="col">Source</th><th scope="col">Confidence</th></tr></thead>
<tbody>
${body}
</tbody>
</table>`;
}

function offerTable(offers: readonly Offer[], quantity: number): string {
  if (offers.length === 0) {
    return '<p class="muted">No distributor offers recorded.</p>';
  }
  const rows = offers
    .map((offer) => {
      const breaks = offer.priceBreaks
        .map(
          (priceBreak) =>
            `${String(priceBreak.quantity)}: ${formatPrice(priceBreak.unitPrice, offer.currency)}`,
        )
        .join('<br>');
      return `<tr>
  <td>${escapeHtml(offer.distributor)}</td>
  <td><code>${escapeHtml(offer.sku)}</code></td>
  <td>${escapeHtml(offer.packaging.replace('_', ' '))}</td>
  <td class="num">${escapeHtml(String(offer.stock))}</td>
  <td class="num">${escapeHtml(String(offer.moq))}</td>
  <td class="num">${breaks === '' ? '<span class="muted">no pricing</span>' : breaks}</td>
</tr>`;
    })
    .join('\n');
  return `<table class="offers">
<caption>Offers, priced at quantity ${escapeHtml(String(quantity))}</caption>
<thead><tr><th scope="col">Distributor</th><th scope="col">SKU</th><th scope="col">Packaging</th><th scope="col">Stock</th><th scope="col">MOQ</th><th scope="col">Price breaks</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`;
}

function classificationList(part: Part): string {
  if (part.classifications.length === 0) {
    return '<p class="muted">Not classified.</p>';
  }
  const items = part.classifications
    .map((classification) => {
      const value = Array.isArray(classification.value)
        ? classification.value.join(', ')
        : classification.value;
      return `<div class="pair">
  <dt>${escapeHtml(classification.axis)}</dt>
  <dd>${escapeHtml(value === '' ? 'none' : value)} <span class="muted">via ${escapeHtml(classification.rule)}</span></dd>
</div>`;
    })
    .join('\n');
  return `<dl class="pairs">\n${items}\n</dl>`;
}

function verificationTable(part: Part): string {
  if (part.verifications.length === 0) {
    return '<p class="muted">Not verified. Values are as extracted.</p>';
  }
  const rows = part.verifications
    .map(
      (verification) => `<tr>
  <th scope="row"><code>${escapeHtml(verification.parameterKey)}</code></th>
  <td>${tag('span', `badge ${verification.verdict}`, verification.verdict.replace('_', ' '))}</td>
  <td class="num">${escapeHtml(String(verification.page))}</td>
  <td>${verification.quote === undefined ? '<span class="muted">no quote</span>' : escapeHtml(verification.quote)}</td>
  <td><code>${escapeHtml(verification.promptVersion)}</code> ${escapeHtml(verification.model)}</td>
</tr>`,
    )
    .join('\n');
  return `<table class="verifications">
<caption>Verification</caption>
<thead><tr><th scope="col">Parameter</th><th scope="col">Verdict</th><th scope="col">Page</th><th scope="col">Quote</th><th scope="col">Checked by</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`;
}

function datasheetBlock(part: Part): string {
  const datasheet = part.datasheet;
  if (datasheet === undefined) {
    return '<p class="muted">No datasheet attached. Every value came from elsewhere.</p>';
  }
  const covers =
    datasheet.coversMpns.length === 0
      ? '<span class="muted">ordering table not read yet</span>'
      : datasheet.coversMpns.map((mpn) => `<code>${escapeHtml(mpn)}</code>`).join(', ');
  return `<dl class="pairs">
  <div class="pair"><dt>Source</dt><dd><a href="${escapeHtml(datasheet.url)}">${escapeHtml(datasheet.url)}</a></dd></div>
  <div class="pair"><dt>Digest</dt><dd><code>${escapeHtml(datasheet.sha256.slice(0, 16))}…</code></dd></div>
  <div class="pair"><dt>Pages</dt><dd>${escapeHtml(String(datasheet.pageCount))}</dd></div>
  <div class="pair"><dt>Also covers</dt><dd>${covers}</dd></div>
</dl>`;
}

/**
 * Each cited page beside the values taken from it.
 *
 * This is the section that justifies a report at all: checking an extraction
 * means reading the page and the claim together, which a table cannot do.
 */
function pagesBlock(rows: readonly ParameterRow[], images: ReadonlyMap<number, string>): string {
  // Collected against the image, so nothing downstream needs a lookup that
  // could fail.
  const byPage = new Map<number, { image: string; cited: ParameterRow[] }>();
  for (const row of rows) {
    const image = row.page === undefined ? undefined : images.get(row.page);
    if (row.page === undefined || image === undefined) {
      continue;
    }
    const existing = byPage.get(row.page) ?? { image, cited: [] };
    existing.cited.push(row);
    byPage.set(row.page, existing);
  }
  const pages = [...byPage.entries()]
    .map(([page, entry]) => ({ page, ...entry }))
    .sort((a, b) => a.page - b.page);

  if (pages.length === 0) {
    return '';
  }
  const blocks = pages
    .map(({ page, cited, image }) => {
      const list = cited
        .map(
          (row) =>
            `<li><code>${escapeHtml(row.key)}</code> ${escapeHtml(row.value)}${
              row.quote === undefined ? '' : `<div class="quote">${escapeHtml(row.quote)}</div>`
            }</li>`,
        )
        .join('\n');
      return `<figure class="page">
  <img src="${escapeHtml(image)}" alt="Datasheet page ${escapeHtml(String(page))}">
  <figcaption>
    <h3>Page ${escapeHtml(String(page))}</h3>
    <ul>${list}</ul>
  </figcaption>
</figure>`;
    })
    .join('\n');
  return `<section>
<h2>Cited pages</h2>
<p>Each page shown with the values taken from it, so a claim can be checked against the page that supports it.</p>
${blocks}
</section>`;
}

function summary(part: Part, rows: readonly ParameterRow[], quantity: number): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.confidence, (counts.get(row.confidence) ?? 0) + 1);
  }
  const currency = part.offers[0]?.currency;
  const best =
    currency === undefined ? undefined : selectBestPrice(part.offers, quantity, currency);
  const price =
    best === undefined
      ? `<span class="muted">no price at this quantity</span>`
      : `${escapeHtml(formatPrice(best.unitPrice, best.currency))} <span class="muted">from ${escapeHtml(best.offer.distributor)} ${escapeHtml(best.offer.sku)}</span>`;
  const confidence = [...counts.entries()]
    .map(([name, count]) => `${String(count)} ${name}`)
    .join(', ');
  return `<dl class="pairs summary">
  <div class="pair"><dt>Status</dt><dd>${tag('span', `badge ${part.status}`, part.status.replace('_', ' '))}</dd></div>
  <div class="pair"><dt>Parameters</dt><dd>${escapeHtml(confidence)}</dd></div>
  <div class="pair"><dt>Offers</dt><dd>${escapeHtml(String(part.offers.length))}</dd></div>
  <div class="pair"><dt>Best at ${escapeHtml(String(quantity))}</dt><dd>${price}</dd></div>
</dl>`;
}

/**
 * Renders one part as a standalone HTML page.
 *
 * The output is a `title`, a `style`, and body markup, with no document
 * wrapper. A browser renders that correctly from a file, and it is also
 * exactly the shape the artifact publisher expects, so one function serves
 * both without a flag.
 */
export function renderPartReport(part: Part, options: PartReportOptions = {}): string {
  const quantity = options.quantity ?? 1;
  const rows = rowsOf(part);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const pages = options.pageImages === undefined ? '' : pagesBlock(rows, options.pageImages);

  return `<title>${escapeHtml(part.mpn)}</title>
<style>${REPORT_STYLE}</style>
<article class="report">
<header>
  <p class="eyebrow">${escapeHtml(part.category.replace('_', ' '))} · extraction report</p>
  <h1>${escapeHtml(part.mpn)}</h1>
  <p class="lede">${escapeHtml(part.manufacturer)}</p>
  ${summary(part, rows, quantity)}
</header>

<section>
<h2>Parameters</h2>
<p>Every value with where it came from. A value from a datasheet cites the page it was read on; the schema has no shape for one without.</p>
${parameterTable(rows)}
</section>

${pages}

<section>
<h2>Datasheet</h2>
${datasheetBlock(part)}
</section>

<section>
<h2>Offers</h2>
${offerTable(part.offers, quantity)}
</section>

<section>
<h2>Classification</h2>
${classificationList(part)}
</section>

<section>
<h2>Verification</h2>
${verificationTable(part)}
</section>

<footer>
  <p>Recorded ${escapeHtml(part.createdAt)}, updated ${escapeHtml(part.updatedAt)}. Report generated ${escapeHtml(generatedAt)}.</p>
</footer>
</article>`;
}
