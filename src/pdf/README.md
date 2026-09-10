# pdf

PDF toolkit (Module 6): fetch a datasheet, learn its shape, read pages as
text, render pages as images, and locate sections. Everything goes through
poppler subprocesses and the cache, so a rerun spawns no process and makes no
request. Import from `src/pdf/index.ts`.

## Subprocess wrapper (`subprocess.ts`)

`run(bin, args, { timeoutMs?, maxOutputBytes?, cwd?, allowExitCodes?,
spawner? })` returns `{ stdout, stderr, code }`. Defaults: 30 s timeout,
64 MiB output cap, success only on exit 0. Errors are `SubprocessError`:

| Code | Cause |
| --- | --- |
| `SUBPROCESS_SPAWN_FAILED` | The binary could not be started. |
| `SUBPROCESS_TIMEOUT` | Killed with SIGKILL after the timeout. |
| `SUBPROCESS_OUTPUT_TOO_LARGE` | Killed once stdout passed the cap. |
| `SUBPROCESS_FAILED` | Exit code outside `allowExitCodes`; carries the code, signal, and first 2000 characters of stderr. |

`spawner` is the injection seam for tests; `SpawnedProcess` is the minimal
child-process shape used.

## Preflight (`poppler.ts`)

`popplerPreflight({ binaries?, run?, timeoutMs? })` runs `-v` on `pdftotext`,
`pdftoppm`, and `pdfinfo`, returning the resolved command names and their
versions. Every tool that cannot be run is collected and reported together as
`PopplerMissingError` (`POPPLER_MISSING`) with an install hint. A banner it
cannot parse is recorded as version `unknown`.

## Toolkit (`toolkit.ts`)

`new PdfToolkit({ cache, store, tools, run?, fetch?, sleep?, timeoutMs?,
tempDir? })`. A `PdfRef` is `{ localPath, sha256 }`, which `fetchPdf` returns.

- `fetchPdf(url, options?)` delegates to `fetch-pdf.ts` (below).
- `pdfInfo(ref)` gives `{ pageCount, title, producer, encrypted }`.
- `readPages(ref, pages)` runs `pdftotext -layout` once per page, cached per
  page, and returns `{ page, text, metrics, hit }` in the order asked for.
- `renderPage(ref, page, dpi = 200)` runs `pdftoppm -png -singlefile` into a
  temporary directory, caches the PNG, and returns its path and bytes. A
  different resolution is a different cache entry.
- `allPages(ref)` is one `pdftotext` call for the whole document, split on
  form feeds with the empty tail dropped.
- `findPages(ref, patterns?)` scans that text and returns, per pattern name,
  the pages and matching lines. Defaults to `SECTION_PATTERNS`: ordering
  information, electrical characteristics, absolute maximum ratings,
  recommended operating conditions, pin configuration, package information.

Errors are `PdfError`: `PDF_INVALID_PAGE` (not a positive integer),
`PDF_PAGE_OUT_OF_RANGE` (beyond the document; checked before spawning,
because poppler exits non-zero for a bad page range), `PDF_INVALID_DPI`
(outside 36 to 1200), `PDF_RENDER_EMPTY` (the renderer produced no image).
Cache namespaces are versioned by `EXTRACTION_VERSION`; bump it when the
extraction arguments change so old text is not reused.

## Fetching (`fetch-pdf.ts`)

`fetchPdf(deps, url, options?)` downloads through the cache and returns
`{ url, localPath, sha256, bytes, size, hit }`, where `localPath` is the
cached file itself. It follows redirects (absolute or relative) up to
`maxRedirects`, retries 408, 429, 5xx, and network failures up to
`maxAttempts` with exponential backoff, enforces a size cap against both the
declared content length and the bytes received, rejects a content type that
is not a PDF, and checks the `%PDF-` magic bytes. Errors are `PdfFetchError`:
`PDF_FETCH_FAILED`, `PDF_REDIRECT_INVALID`, `PDF_TOO_MANY_REDIRECTS`,
`PDF_CONTENT_TYPE`, `PDF_NOT_A_PDF`, `PDF_TOO_LARGE`. `fetch` and `sleep` are
injection seams.

## Page metrics (`metrics.ts`)

`pageMetrics(text)` measures the shape of one page's extracted text so the
agent can decide, without judgement, when a table has been mangled and the
page should be read as an image instead:

| Field | Meaning |
| --- | --- |
| `lineCount`, `nonEmptyLineCount` | Size of the page. |
| `maxColumns`, `medianColumns` | Cells per line, splitting on runs of two or more spaces. |
| `numericTokenCount` | Tokens that are a number with an optional unit suffix. |
| `orphanNumericLineCount`, `orphanNumericRatio` | Lines holding numbers but no word of two or more letters, and their share of the page. |
| `suspectTable` | At least three non-empty lines, at least six numeric tokens, and either an orphan ratio of 0.3 or more, or a median of four or more columns. |

## Info parsing (`pdf-info.ts`)

`parsePdfInfo(text)` reads `pdfinfo` output. Field matching uses horizontal
whitespace only, so an empty field cannot absorb the following line. Output
with no page count is `PdfInfoError` (`PDF_INFO_UNPARSEABLE`).

## Tests

Fixtures are generated at test time with `pdf-lib` (`test/helpers/pdf-fixtures.ts`),
so no copyrighted datasheet is committed, and every poppler path runs for
real. HTTP is served by Mock Service Worker through `test/helpers/msw.ts`.
