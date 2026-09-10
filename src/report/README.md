# report

Renders stored data as a standalone HTML page. Import from
`src/report/index.ts`.

This exists because the one task a table cannot do is checking an extracted
value against the page it was read from. Everything else about the data is
better served by a query, so this is a generator rather than an application:
no server, no port, no session state, nothing to keep running.

## `renderPartReport(part, options?)`

Returns a complete page for one `Part`: a `title`, a `style`, and body markup,
with **no document wrapper**. A browser renders that correctly from a file,
and it is exactly the shape the artifact publisher expects, so one function
serves both without a flag.

Options:

| Option | Effect |
| --- | --- |
| `pageImages` | A map of page number to anything an `img` can load. Supplying it turns on the cited-pages section, which puts each page beside the values taken from it. |
| `quantity` | Quantity used for the price summary. Default 1. |
| `generatedAt` | Timestamp in the footer. Defaults to now. |

Sections: a summary (status, confidence counts, offer count, best price at the
quantity), every parameter with its value, source and confidence, the cited
pages, the datasheet, offers with price breaks, classifications with the rule
that produced each, and verifications with verdict, page and quote.

Values are shown in engineering notation (`570 kHz`, not `570000 Hz`) because
the report is read against a datasheet, which writes them the same way. That is
display only; the stored value stays canonical.

Everything interpolated goes through `escapeHtml`. Real data contains markup
characters: `8-SOIC (0.154", 3.90mm Width)` is a Digi-Key package name.

## `collectPageImages(part, renderer, options?)`

Renders each cited page and returns it as a data URI, so the report is one
self-contained file. `renderer` is any object with the PDF toolkit's
`renderPage`, so tests need no poppler. A part with no datasheet yields
nothing, and a page larger than `maxBytesPerPage` (4 MiB default) is skipped
rather than bloating the report; its parameters still appear in the table.

`citedPages(part)` lists the distinct pages a datasheet-sourced parameter
cites, in order.

## Command line

```bash
npx tsx scripts/render-part-report.ts TPS54331DR
npx tsx scripts/render-part-report.ts TPS54331DR --out report.html --quantity 100
npx tsx scripts/render-part-report.ts TPS54331DR --no-pages
```

The part must already be stored, which means an extraction run has to have
happened. Until the runner exists there is nothing to render.

## Not here yet

Evaluation-run reports belong to Module 16 and will reuse the same style and
escaping.
