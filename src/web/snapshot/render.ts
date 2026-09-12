import { escapeHtml } from '../../report/escape.js';
import { rampColor, seriesColor } from '../ui/charts/palette.js';
import type { Snapshot } from './build.js';

/**
 * The snapshot as one file.
 *
 * Hand-written HTML with the numbers inlined and the charts drawn as SVG:
 * nothing is fetched, nothing is executed, and the file opens from a
 * directory or from a link with equal success. The site's own bundle would
 * need a server behind it; this needs nothing.
 */

function usd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function count(value: number): string {
  return value.toLocaleString('en-AU');
}

function row(cells: readonly string[], tag: 'td' | 'th' = 'td'): string {
  return `<tr>${cells.map((cell) => `<${tag}>${cell}</${tag}>`).join('')}</tr>`;
}

/** Spend over time, as an SVG line with its own axis labels. */
function spendChart(snapshot: Snapshot): string {
  const points = snapshot.spend;
  if (points.length === 0) {
    return '<p class="empty">nothing has been spent.</p>';
  }
  const width = 720;
  const height = 220;
  const top = 16;
  const bottom = height - 28;
  const largest = points.reduce((most, point) => Math.max(most, point.cumulativeUsd), 0);
  const step = points.length === 1 ? 0 : (width - 80) / (points.length - 1);
  const x = (index: number): number => 60 + index * step;
  const y = (value: number): number =>
    largest === 0 ? bottom : bottom - (value / largest) * (bottom - top);
  const period = snapshot.spendGranularity;
  const line = (pick: (point: (typeof points)[number]) => number): string =>
    points.map((point, index) => `${String(x(index))},${String(y(pick(point)))}`).join(' ');
  return `
<svg viewBox="0 0 ${String(width)} ${String(height)}" role="img" aria-label="what it cost, ${period} by ${period}">
  <line x1="60" y1="${String(bottom)}" x2="${String(width - 20)}" y2="${String(bottom)}" class="axis" />
  <polyline points="${line((point) => point.cumulativeUsd)}" fill="none" stroke="${seriesColor(1)}" stroke-width="2" />
  <polyline points="${line((point) => point.costUsd)}" fill="none" stroke="${seriesColor(0)}" stroke-width="2" />
  ${points
    .map(
      (point, index) =>
        `<circle cx="${String(x(index))}" cy="${String(y(point.cumulativeUsd))}" r="3" fill="${seriesColor(1)}"><title>${escapeHtml(point.key)}: ${usd(point.cumulativeUsd)} in total</title></circle>` +
        `<circle cx="${String(x(index))}" cy="${String(y(point.costUsd))}" r="3" fill="${seriesColor(0)}"><title>${escapeHtml(point.key)}: ${usd(point.costUsd)}</title></circle>` +
        `<text x="${String(x(index))}" y="${String(height - 8)}" text-anchor="middle" class="tick">${escapeHtml(point.key.slice(5))}</text>`,
    )
    .join('')}
  <text x="56" y="${String(top + 8)}" text-anchor="end" class="tick">${usd(largest)}</text>
  <text x="56" y="${String(bottom)}" text-anchor="end" class="tick">$0</text>
</svg>
<ul class="legend">
  <li><span class="swatch" style="background:${seriesColor(0)}"></span>spent that ${period}</li>
  <li><span class="swatch" style="background:${seriesColor(1)}"></span>spent in total</li>
</ul>`;
}

/** The coverage grid, as a table whose cells are shaded by the same ramp the site uses. */
function coverageGrid(snapshot: Snapshot): string {
  const parts = snapshot.totals.parts;
  const cell = (value: number): string =>
    `<td class="heat" style="background:${rampColor(parts === 0 ? 0 : value / parts)}">${count(value)}</td>`;
  return `
<table>
  <thead>${row(['parameter', 'found', 'cites a page', 'confirmed', 'disputed'], 'th')}</thead>
  <tbody>
    ${snapshot.coverage
      .map(
        (one) =>
          `<tr><td>${escapeHtml(one.key)}</td>${cell(one.stated)}${cell(one.cited)}${cell(one.verified)}${cell(
            one.conflicted + one.contradicted,
          )}</tr>`,
      )
      .join('')}
  </tbody>
</table>`;
}

const STYLE = `
:root {
  color-scheme: light;
  --plane: #f9f9f7; --surface: #fcfcfb; --line: #e2e1dc;
  --ink: #0b0b0b; --ink-2: #52514e; --ink-3: #77766f; --accent: #2a78d6;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    color-scheme: dark;
    --plane: #0d0d0d; --surface: #1a1a19; --line: #383835;
    --ink: #fff; --ink-2: #c3c2b7; --ink-3: #96958c; --accent: #3987e5;
  }
}
/* Stated twice on purpose: a host that sets the attribute wins over the
   preference, in both directions. */
:root[data-theme='dark'] {
  color-scheme: dark;
  --plane: #0d0d0d; --surface: #1a1a19; --line: #383835;
  --ink: #fff; --ink-2: #c3c2b7; --ink-3: #96958c; --accent: #3987e5;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--plane); color: var(--ink);
  font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
main { margin: 0 auto; max-width: 960px; padding: 24px 16px 64px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 16px; margin: 32px 0 8px; }
p.lede, p.caption { color: var(--ink-2); margin: 0 0 8px; }
.cards { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); margin: 16px 0; }
.card, section.panel { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; }
section.panel { overflow-x: auto; }
.card .label { color: var(--ink-2); font-size: 12px; }
.card .value { font-size: 22px; font-variant-numeric: tabular-nums; }
.card .note { color: var(--ink-3); font-size: 11px; }
table { border-collapse: collapse; font-variant-numeric: tabular-nums; width: 100%; }
th { border-bottom: 1px solid var(--line); color: var(--ink-2); font-size: 12px; text-align: left; padding: 6px 8px; }
td { border-bottom: 1px solid var(--line); padding: 5px 8px; }
td.heat { color: #0b0b0b; text-align: right; }
svg { max-width: 100%; }
.axis { stroke: var(--line); }
.tick { fill: var(--ink-3); font-size: 10px; }
.legend { display: flex; gap: 14px; list-style: none; padding: 0; color: var(--ink-2); font-size: 12px; }
.swatch { border-radius: 3px; display: inline-block; height: 10px; margin-right: 5px; width: 10px; }
.empty { color: var(--ink-2); }
footer { color: var(--ink-3); font-size: 12px; margin-top: 40px; }
code { font-family: ui-monospace, Menlo, Consolas, monospace; }
`;

/** The whole page, as one string. */
export function renderSnapshot(snapshot: Snapshot): string {
  const evaluation = snapshot.evaluations[0];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>chip datasheet agent — snapshot</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>chip datasheet agent</h1>
<p class="lede">
  what this installation has extracted, what it cost, and how well it scored.
  taken ${escapeHtml(snapshot.takenAt)} from <code>${escapeHtml(snapshot.source)}</code>,
  version ${escapeHtml(snapshot.version)}.
</p>

<div class="cards">
  <div class="card"><div class="label">parts</div><div class="value">${count(snapshot.totals.parts)}</div><div class="note">${count(snapshot.totals.datasheets)} datasheets</div></div>
  <div class="card"><div class="label">parameters found</div><div class="value">${count(snapshot.value.parametersStated)}</div><div class="note">${count(snapshot.value.parametersVerified)} confirmed by a second pass</div></div>
  <div class="card"><div class="label">spent</div><div class="value">${usd(snapshot.runs.costUsd)}</div><div class="note">${count(snapshot.runs.runs)} runs, ${count(snapshot.runs.turns)} turns</div></div>
  <div class="card"><div class="label">a part costs</div><div class="value">${usd(snapshot.value.perPart)}</div><div class="note">${usd(snapshot.value.perStatedParameter)} a parameter</div></div>
  <div class="card"><div class="label">tool calls</div><div class="value">${count(snapshot.runs.toolCalls)}</div><div class="note">${count(snapshot.cache.misses)} wanted something uncached</div></div>
</div>

<h2>what it has cost</h2>
<section class="panel">${spendChart(snapshot)}</section>

<h2>what the extraction reliably finds</h2>
<p class="caption">of ${count(snapshot.totals.parts)} parts, how many state each parameter, cite a page for it, and have had it confirmed.</p>
<section class="panel">${coverageGrid(snapshot)}</section>

<h2>the parts</h2>
<section class="panel">
<table>
  <thead>${row(['part', 'manufacturer', 'status', 'found', 'confirmed', 'disputed', 'each at 100'], 'th')}</thead>
  <tbody>
  ${snapshot.parts
    .map((part) =>
      row([
        escapeHtml(part.mpn),
        escapeHtml(part.manufacturer),
        escapeHtml(part.status.replace(/_/gu, ' ')),
        count(part.stated),
        count(part.confirmed),
        count(part.contradicted),
        part.bestPriceAud === null ? '—' : `AUD ${part.bestPriceAud.toFixed(3)}`,
      ]),
    )
    .join('')}
  </tbody>
</table>
</section>

<h2>the tools it used</h2>
<section class="panel">
<table>
  <thead>${row(['tool', 'calls', 'failed', 'median', '90th percentile'], 'th')}</thead>
  <tbody>
  ${snapshot.tools
    .map((tool) =>
      row([
        escapeHtml(tool.tool),
        count(tool.calls),
        tool.failures === 0 ? '—' : count(tool.failures),
        `${String(Math.round(tool.medianMs))} ms`,
        `${String(Math.round(tool.p90Ms))} ms`,
      ]),
    )
    .join('')}
  </tbody>
</table>
</section>

<h2>how well it scored</h2>
${
  evaluation === undefined
    ? '<p class="empty">no evaluation has been run against the golden set.</p>'
    : `<section class="panel">
<p class="caption">${escapeHtml(evaluation.promptVersion)} on ${escapeHtml(evaluation.model)}, ${count(evaluation.parts)} parts, ${usd(evaluation.costUsd)}.</p>
<table>
  <thead>${row(['measure', 'value'], 'th')}</thead>
  <tbody>
    ${row(['recall', percent(evaluation.recall)])}
    ${row(['precision', percent(evaluation.precision)])}
    ${row(['citations exact', percent(evaluation.provenanceAccuracy)])}
    ${row(['citations one page out', percent(evaluation.withinOnePage)])}
  </tbody>
</table>
</section>`
}

<footer>
  <p>this snapshot deliberately leaves out:</p>
  <ul>${snapshot.excluded.map((one) => `<li>${escapeHtml(one)}</li>`).join('')}</ul>
</footer>
</main>
</body>
</html>
`;
}
