# web

The site: a local HTTP server, a React front end, and a shareable snapshot,
over the same repositories, ledger, evaluation reports and run harness the CLI
uses. It owns no domain logic. Import from `src/web/create.ts` (the assembled
parts) or `src/web/cli.ts` (the command line over them).

## Running it

```
npm run web                          # http://127.0.0.1:5174, token printed
npm run web -- --port 8080 --data ./data
npm run web -- --host 0.0.0.0        # announced, and only ever deliberate
npm run build:ui                     # the browser bundle, into dist/ui
npm run web:snapshot                 # one shareable file, then exit
npx tsx bin/chip-web.ts --snapshot out.html --source <eval-run-id>
```

The address printed carries the token (`/?token=…`). Opening it trades the
token for a cookie pair and redirects; nothing else is a sign-in. A restart
mints a new token unless `--token` says otherwise, and the front end must be
built or every page answers 503 `WEB_UI_NOT_BUILT` while the API keeps working.

## The pieces

| Directory          | What it owns                                                        |
| ------------------ | ------------------------------------------------------------------- |
| `server/`          | router, responder, errors, security, SSE, the app, the socket        |
| `data/`            | read models: catalog, ledger index, spend and latency stats, evals   |
| `api/`             | the endpoints, one module per subject, registered in `api/index.ts`  |
| `runs/`            | the launch registry and the launcher that starts real runs           |
| `snapshot/`        | the self-contained page: build, render, write                        |
| `ui/`              | the React front end — pages, charts, components, its own tsconfig    |
| `audit.ts`         | the write wrapper: no change without a row saying who and why        |
| `create.ts`        | composition; `cli.ts` / `bin/chip-web.ts` the command line           |

## Sources

Every read takes `?source=`. `live` is the store in the data directory; any
file under `data/eval-runs/*.sqlite` is addressable by its id. The front end
reads it from the address when it is there and from the selector otherwise, so
a link to a part in an evaluation run opens that run's copy. Only `live` is
writable — a write to an evaluation database is refused with 403
`WEB_SOURCE_READ_ONLY`, because those are evidence of what a run did and
editing them would make the eval a rewrite of its own history (D65).

## Endpoints

Read (`GET`, all of them taking `?source=`):

```
/api/ping /api/health /api/meta /api/sources
/api/parts /api/parts/:mpn{,/parameters,/parameters/:key,/offers,/runs,/verifications}
/api/catalog/totals /api/catalog/coverage /api/catalog/compare /api/catalog/distribution/:key
/api/datasheets /api/datasheets/:sha256{,/sections,/search,/pages/:page,/pages/:page/image}
/api/alternates /api/alternates/constraints
/api/runs /api/runs/:id /api/ledger /api/ledger/:id /api/ledger/tools /api/ledger/sessions/:id
/api/stats/overview /api/stats/spend /api/stats/spend/:dimension /api/stats/tools
/api/stats/errors /api/stats/cache /api/stats/gate /api/stats/value /api/stats/estimate
/api/evals /api/evals/compare /api/evals/:id{,/summary,/parameters,/failures}
/api/golden /api/golden/health /api/golden/:mpn
/api/cache /api/cache/:namespace /api/escalations /api/audit
/api/launches /api/launches/:id /api/launches/:id/events /api/launches/estimate
```

Write (`POST` unless noted), every one of them audited:

```
/api/parts/:mpn/parameters/:key   correct a value, keeping the model's
/api/parts/:mpn/status            move a part between states
/api/escalations/:id/resolve      answer what the run asked a human
/api/golden/:mpn                  (PUT) replace a golden file
/api/cache/purge                  drop cached entries by namespace or key
/api/launches                     start a run; /:id/cancel stops one
```

`/api/launches/:id/events` is an event stream — turns, cost, tool calls and
the result as they happen, replayed from the start for a late subscriber.

## Errors

Every failure is `{ error: { code, message, status, details? } }`. `details`
appears on client errors only and is redacted like everything else. Statuses
come from `statusFor`: the code first (`CACHE_MISS` is 409 because the resource
exists and the run may not pay for it; a budget refusal is 402), then the error
class, then 500. A code ending in `_NOT_FOUND` is 404 without being listed.
Server-side failures are logged in full and answered with a bare 500 — the
message of an internal error is not the browser's business.

## Security

The machine running this holds distributor credentials and a button that
spends money, so the model is deliberately small and stated in one place
(`server/security.ts`, D67):

- **Loopback by default.** `--host` anything else prints a warning first.
- **A token per start**, 32 random bytes. `GET /?token=…` trades it for
  `chip_session` (HttpOnly) and `chip_csrf` (readable) and redirects, so the
  token leaves the address bar and the browser history entry.
- **Double-submit on writes.** A state-changing request repeats the token in
  `x-chip-token`; a cross-site page can neither read the cookie nor set the
  header. Reads accept the cookie, a bearer header, or `?token=` (the handoff).
- **Origin checked** on writes; a foreign `Origin` is 403 `WEB_ORIGIN_REFUSED`.
- **Credentials are booleans.** `/api/health` reports which are configured,
  never their values, and every response passes through the redactor.
- **Bodies are capped** at 4 MiB; over that is 413.

## Caching

`respond.json` sets one of three policies and an ETag: `live` (`no-cache`, for
anything that changes as runs happen), `derived` (a day, for a rendered
datasheet page), `asset` (a year, immutable, for the hashed bundle). A
conditional request that matches answers 304 with no body, and `HEAD` answers
the headers alone.

## The snapshot

`buildSnapshot` reads the same read models the pages use, so there is no second
version of the numbers; `renderSnapshot` writes the whole thing as one file
with the charts as inline SVG. It fetches nothing and runs nothing, and opens
from a directory or a link.

What it leaves out is enforced in code and printed on the page itself (D68):
credentials and every value read from the environment; datasheet text and page
images, which are the manufacturers' copyright; and tool inputs and outputs,
which hold distributors' data. Part numbers and prices are included; nothing
else from a distributor is.

## Invariants

- The browser never reaches the network, the database or the model. It reaches
  this server, and this server reaches the modules that already know how.
- Read models are pure functions over loaded data, tested without a server.
- Nothing is written without an audit row — the change and the row are one
  transaction, and a reason of at least three characters is mandatory.
- A run started here goes through `executeRun` and the same three money gates
  as the CLI, plus a per-launch ceiling checked between parts (D64).
- Every file in this directory is at 100% lines, branches, functions and
  statements, and the site carries the fifth layer the rest of `src/` does not:
  Playwright against a seeded temporary data directory, never the live store.
