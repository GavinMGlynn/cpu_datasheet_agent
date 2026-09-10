/**
 * Styling for generated reports.
 *
 * Self-contained: no external fonts or stylesheets, so a report opens from a
 * file with no network. Colours are defined as tokens on `:root` and
 * redefined for a dark preference, so a report is readable either way.
 */
export const REPORT_STYLE = `
:root {
  --ground: #f3f4f2; --surface: #fff; --ink: #16191a; --muted: #5e6664;
  --rule: #dcdfdc; --accent: #0d6f78; --warn: #8a5a00; --alarm: #9d3423;
  --ok: #1f6b3a;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground: #0e1211; --surface: #171b1a; --ink: #e6ecea; --muted: #9aa5a1;
    --rule: #262d2b; --accent: #45b6c0; --warn: #d3a24a; --alarm: #e59180;
    --ok: #6cc48c;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--ground); color: var(--ink);
  font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
.report { max-width: 60rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
header { border-bottom: 2px solid var(--ink); padding-bottom: 1.25rem; margin-bottom: 1rem; }
.eyebrow { margin: 0 0 .35rem; font-size: .72rem; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
h1 { margin: 0; font-size: 2rem; letter-spacing: -.02em; }
.lede { margin: .25rem 0 1rem; color: var(--muted); font-size: 1.05rem; }
h2 { margin: 2.25rem 0 .5rem; font-size: 1.15rem; letter-spacing: -.01em; }
h3 { margin: 0 0 .4rem; font-size: .95rem; }
p { margin: 0 0 .9rem; max-width: 46rem; color: var(--ink); }
section > p:first-of-type { color: var(--muted); }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .86em; }
a { color: var(--accent); overflow-wrap: anywhere; }
table { border-collapse: collapse; width: 100%; margin: .5rem 0 1rem; font-size: .92rem; }
caption { text-align: left; font-size: .72rem; letter-spacing: .12em; text-transform: uppercase;
  color: var(--muted); padding-bottom: .5rem; }
th, td { text-align: left; vertical-align: top; padding: .5rem .75rem .5rem 0; border-bottom: 1px solid var(--rule); }
thead th { font-size: .72rem; letter-spacing: .05em; text-transform: uppercase; color: var(--muted);
  border-bottom-width: 1.5px; }
tbody th { font-weight: 600; white-space: nowrap; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.muted { color: var(--muted); }
.quote { margin-top: .3rem; padding-left: .6rem; border-left: 2px solid var(--rule);
  color: var(--muted); font-size: .88em; }
.badge { display: inline-block; padding: .1rem .45rem; border: 1px solid currentColor;
  border-radius: 999px; font-size: .72rem; letter-spacing: .03em; white-space: nowrap; }
.badge.verified, .badge.confirmed { color: var(--ok); }
.badge.extracted { color: var(--muted); }
.badge.conflict, .badge.contradicted, .badge.rejected { color: var(--alarm); }
.badge.needs_human, .badge.not_found { color: var(--warn); }
.pairs { display: grid; gap: .4rem; margin: 0 0 1rem; }
.summary { grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: .75rem 1.5rem; }
.pair { display: grid; gap: .1rem; padding: .5rem .75rem .5rem 0; border-bottom: 1px solid var(--rule); }
.pair dt { font-size: .72rem; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
.pair dd { margin: 0; }
figure.page { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 1.25rem;
  margin: 0 0 1.5rem; padding: 1rem; background: var(--surface); border: 1px solid var(--rule); border-radius: 6px; }
figure.page img { width: 100%; height: auto; border: 1px solid var(--rule); background: #fff; }
figure.page ul { margin: 0; padding-left: 1.1rem; }
figure.page li { margin-bottom: .4rem; }
footer { margin-top: 2.5rem; padding-top: 1rem; border-top: 1px solid var(--rule);
  color: var(--muted); font-size: .82rem; }
@media (max-width: 700px) { figure.page { grid-template-columns: 1fr; } }
`;
