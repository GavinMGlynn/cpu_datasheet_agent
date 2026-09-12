# Project Plan and Development History

This is the living record of the project. It is the first thing to read when
picking the work up, and the last thing to update before putting it down.

- `CLAUDE.md` (repo root) is the brief: what the project is and the rules that
  never change.
- `docs/PROJECT_PLAN.md` (this file) is the journal: decisions, conventions,
  current status, and a dated log of every working session.
- `docs/COMPLETION_PLAN.md` is the task list: every concrete task that must be
  done for the project to be 100% complete, grouped into modules that are
  completed strictly in order.
- `docs/REFERENCES.md` is the bibliography: every external document, API,
  library, and web page we rely on, with a verification status.

## 1. How to use this file

### Pick-up checklist (start of every session)

1. Read `CLAUDE.md`.
2. Read section 4 (Status) and the three most recent entries in section 7
   (Development log) of this file.
3. Open `docs/COMPLETION_PLAN.md` at the module marked **in progress** (or the
   first module marked **not started** if none is in progress).
4. Run `git status` and `git log --oneline -5`. The tree should be clean and
   the last commit should match the last log entry. If not, reconcile before
   doing anything else.
5. Once Module 0 exists, run `npm run check` and confirm it is green before
   changing anything.
6. Work only on the current module. Do not start the next one.

### Put-down checklist (end of every session, or every time docs change)

1. Update the status table in section 4.
2. Add a dated entry at the top of section 7 saying what was done, what was
   learned, and what the next concrete step is.
3. Add any new external source consulted to `docs/REFERENCES.md`.
4. Commit and push. Every commit is pushed immediately. GitHub is always
   current.

## 2. Project summary

An agent that, given a chip part number, downloads the datasheet, extracts
electrical parameters with page-level provenance, pulls distributor pricing,
reconciles the two, classifies the part, and can then answer questions such as
"find a cheaper alternate to this buck regulator that still meets my Vin
range". See `CLAUDE.md` for the architecture, data sources, and the
non-negotiable rules (provenance, reject-never-coerce, escalate-never-guess,
log every tool call).

First and only component category until it is complete end to end: **buck
regulators** (synchronous and non-synchronous, integrated-FET and controller).

## 3. Decisions record

Decisions are numbered and never deleted. A reversed decision gets a new row
that supersedes the old one, and the old row's status changes to
"superseded by Dnn".

| ID  | Date       | Decision | Rationale | Status |
| --- | ---------- | -------- | --------- | ------ |
| D01 | 2026-09-10 | Language: TypeScript on Node 22 LTS, ESM, strict compiler settings. No Python anywhere in the repo, including scripts and tooling. | User preference. One language keeps tests, tooling, and coverage uniform. | active |
| D02 | 2026-09-10 | Modules are completed 100% (implementation, tests, docs) strictly in the order listed in `COMPLETION_PLAN.md`. No MVP, no "come back later", no stubs that throw. | User rule. Partial modules hide unknowns and produce untestable seams. | active |
| D03 | 2026-09-10 | Test runner: Vitest with V8 coverage. Coverage thresholds are 100% for lines, statements, branches, and functions, enforced **per file**, and the check fails the build. | User requires complete test coverage. Per-file thresholds stop one well-tested file from masking an untested one. | active |
| D04 | 2026-09-10 | Third-party code comes from npm by default. A git submodule under `ext/` is used only when a library must be patched, vendored for stability, or is not published to npm. Each submodule gets a one-line justification in this table. | User allowance. Submodules add clone friction, so they are the exception. | active |
| D05 | 2026-09-10 | Local database: SQLite through `better-sqlite3` behind a repository interface. Postgres is reachable later by implementing the same interface. | Synchronous API suits the deterministic layer. Mature, typed, prebuilt binaries. Node's built-in `node:sqlite` is still marked unstable on Node 22. | active |
| D06 | 2026-09-10 | Validation and schema definitions use Zod (v4). Every boundary (tool input, tool output, DB write, API response) is parsed with a strict schema that rejects unknown keys. | Single source of truth for types and runtime checks. Directly implements the reject-never-coerce rule. | active |
| D07 | 2026-09-10 | HTTP in tests is intercepted with Mock Service Worker (`msw`) in `onUnhandledRequest: "error"` mode. Unit tests never touch the network. Live contract tests exist but run only with `LIVE_TESTS=1` and never in CI. | Deterministic tests, and API quota is not spent by the test suite. | active |
| D08 | 2026-09-10 | PDF handling is poppler (`pdftotext`, `pdftoppm`, `pdfinfo`) invoked as subprocesses through one wrapper. Tests exercise poppler for real using PDFs generated at test time with `pdf-lib`. CI installs `poppler-utils`. | Matches `CLAUDE.md`. Generated fixtures avoid committing copyrighted datasheets. | active |
| D09 | 2026-09-10 | MCP server uses the v2 TypeScript SDK (`@modelcontextprotocol/server`), stdio transport, all logging to stderr. | v2 is the stable release line. stdout is owned by the transport, so any stray log line corrupts the protocol. | active |
| D10 | 2026-09-10 | Tool handlers are transport-agnostic functions in `src/tools/`. They are exposed twice over the same registry: as a stdio MCP server for external clients, and as an in-process SDK MCP server (`createSdkMcpServer`) for the agent runner. | One implementation, two thin adapters. In-process servers never delay the agent's first turn. | active |
| D11 | 2026-09-10 | Agent runtime is `@anthropic-ai/claude-agent-sdk`. Default model `claude-opus-5`, effort `high`, both configurable per run. Extraction and verification are separate `query()` calls that share nothing. | Skill guidance defaults to Opus 5. Separation is a `CLAUDE.md` rule. | active |
| D12 | 2026-09-10 | Money and quota are gated twice: a server-side `spendsQuota` flag on tools that enforces a budget policy, and a `PreToolUse` hook in the agent runner that denies gated calls unless the run's budget allows them. | Defence in depth. The hook protects against the agent; the server flag protects against every client. | active |
| D13 | 2026-09-10 | Nexar is fully implemented but disabled by default (`NEXAR_ENABLED=0`). When enabled it reserves budget from a persisted counter with a hard limit (default 90 of the 100-part lifetime evaluation allowance). | `CLAUDE.md` hard limit. Datasheet URLs are also available from Digi-Key and Mouser, so Nexar is rarely required. | active |
| D14 | 2026-09-10 | Digi-Key defaults: locale site AU, language en, currency AUD. Configurable through environment. | User is in Australia. Assumption, see open question Q4. | active |
| D15 | 2026-09-10 | Every doc change is committed and pushed immediately. Every commit is pushed. | User rule. | active |
| D16 | 2026-09-10 | Secrets live only in `.env` (gitignored). `.env.example` lists every variable with a comment. `src/config.ts` validates the environment at startup and fails loudly on anything missing or malformed. | Prevents silent misconfiguration. | active |
| D17 | 2026-09-10 | TypeScript pinned to 6.0.3, not the 7.x line. | `typescript-eslint` 8.70 declares a peer range of `>=4.8.4 <6.1.0`; TypeScript 7 is the native-compiler line and is outside it. Revisit when the linter supports 7. | active |
| D18 | 2026-09-10 | Entry-point shims in `bin/` and `scripts/` hold no logic; all logic lives in `src/` where per-file coverage applies. The gate scanner follows this: `src/gate/scan.ts` is the implementation, `scripts/gate.ts` the shim. | Keeps the coverage gate honest without excluding files. | active |
| D19 | 2026-09-10 | Core schema conventions: strict objects everywhere; unit-pinned quantities per field; `QuantityRange` is `{ unit, min, max, typ? }` (one unit per range); fields the datasheet may not state are `.nullable()` and always present, fields that are genuinely optional annotations are `.optional()`; classification values are typed per axis. | Nullable-and-present makes "not stated" an explicit, provenance-carrying fact rather than an absent key. One unit per range removes a whole class of mismatch. | active |
| D20 | 2026-09-10 | Zero warnings, enforced. `npm run lint` fails on any warning; every other tool must print none. A warning is fixed or silenced at its source with the reason recorded here. | User rule ("we should have no warnings"). Warnings that are tolerated become noise that hides the next real one. | active |
| D21 | 2026-09-10 | CI runs on the user's self-hosted GitHub Actions runner (`[self-hosted, Linux, X64]`, name `localhost`) instead of `ubuntu-latest`. CI verifies poppler is installed rather than installing it, and runs are cancelled when superseded. | User request. The runner is the same WSL host the project targets, so CI exercises the real environment (Rocky Linux, poppler 24.02.0) and needs no package installs. One runner means queued duplicate runs must be cancelled. | active |
| D22 | 2026-09-10 | All Mock Service Worker usage goes through `test/helpers/msw.ts`, the only file with an ESLint exception for the unsafe-call and unsafe-return rules. | msw's request-handler types do not resolve under type-aware linting even though `tsc` accepts them. Confining the boundary to one module keeps every other file strictly checked instead of disabling the rules for all tests. | active |
| D23 | 2026-09-10 | No unreachable defensive fallbacks. Where `noUncheckedIndexedAccess` forces a check on a value the caller has already proved present, use a guarded helper (`group` for regex captures, `elementAt` for arrays) that throws a coded error and is tested directly. | A `?? ''` that can never run is untestable and hides a real off-by-one. The helper turns it into a reachable, named failure. | active |
| D24 | 2026-09-10 | A distributor value that states a bound (`Up to 1MHz`) becomes a `max` or `min` fact, not a quantity and not a range. A value that is inconclusive (`Both` for Synchronous Rectifier, `Fixed, Adjustable` for Output Type, `-`) yields no fact at all. | Recording `Up to 1MHz` as a range would require inventing a lower end, and as a quantity would assert a fixed frequency the part does not have. `Both` corroborates nothing and the datasheet decides, so a fact would be a guess and an error would be noise. | active |
| D25 | 2026-09-10 | Digi-Key response schemas are loose objects with every read field declared. | Digi-Key adds fields over time, so an unknown field is not a reason to reject a response; a declared field that changes type is. Validated against live responses rather than documentation, which is how the nested `AlternatePackagings` wrapper and the optional `BaseProductNumber.Name` were found. | active |
| D26 | 2026-09-10 | Data is viewed through generated static HTML reports, not a web application. Pulled forward as module M7A, out of the planned sequence, at the user's request. | Only one viewing task needs a page: checking a value against the datasheet page it was read from. Queries answer the rest, and a report generator adds no server, port, session state, or thing to keep running. A real application is justified when the data outlives the terminal and other people need it, which is the deferred hosting world. | active |
| D27 | 2026-09-10 | Mouser is a price and availability source only. Its attribute mapping table is empty and every attribute name is reported as unmapped. | Across all 13 recorded switching regulators the Search API returned only `Packaging` and `Standard Pack Qty`, and one part in thirteen carried a datasheet URL. Mapping speculative names would be tested fiction; the table grows from real data or not at all. | active |
| D28 | 2026-09-10 | Recording a tool call must never fail because of the value being recorded. `toErrorJson` drops undefined values before validation. | An error carrying an undefined detail made the ledger throw, replacing the original error with a validation failure. A logging path that destroys the information it exists to preserve is worse than one that drops a key. | active |
| D29 | 2026-09-10 | Module 9 (Nexar) is deferred rather than built next. Modules continue at M10. | The paid Nexar tiers (Standard, Pro) exclude datasheets and tech specs, which are the only reason this project wanted Nexar; they include pricing and availability, which Digi-Key and Mouser already give for free. The free Evaluation tier includes everything but allows 100 matched parts for the lifetime of the account. Paying would buy less than we already have. | active |
| D30 | 2026-09-10 | An element14 (Farnell) key is held and configured, but no adapter is built yet. Revisit after M11 and M16. | Checked live, it is a real second parametric source, which Mouser is not: 32 electrical attributes for TPS54331DR. But it lists only 2 of 5 sample parts on the Australian store and 3 of 5 on the UK store, returns no datasheet field, and prices in the store's currency rather than AUD. The benefit is partial and only measurable once reconciliation and the eval exist. | active |
| D31 | 2026-09-11 | A decoded part number carries both `family` (the number with every suffix removed) and `basePart` (the family plus every code that changes which part you receive, joined with hyphens). Matching compares `basePart`, package code, temperature grade and automotive qualification; only the reel, finish and value-added codes may differ for a "packaging variant". | The plan assumed the base part was the identity. It is not: `LMR33620A` and `LMR33620B` are different regulators, and Digi-Key's `BaseProductNumber` reports the family for both. Comparing families would call two different parts the same reel. Concatenating the codes was ambiguous (`NCV890430` + `50` and `NCV89043` + `050` collide), hence the hyphens. | active |
| D32 | 2026-09-11 | Decoders are declarative tables compiled into one anchored pattern. A package code claims a family or a pin count only where it is proven, otherwise null. Meanings are checked against the recorded corpus first, and against manufacturer documentation for what the corpus cannot show. | The pattern is built from the tables the decode reads, so they cannot drift; `MPN_TABLE_MISSING` fires if they ever do. The corpus proved 466 family and 277 pin-count claims against Digi-Key's own fields, and TI's packaging guide [R-62] then disproved four pin counts the corpus had appeared to confirm, because a code that happens to appear on one pin count looks fixed. | active |
| D33 | 2026-09-11 | `TemperatureGrade` carries `range` (operating) and `guaranteed` (tested and specified) separately. | Analog Devices E and I grades both operate from -40 °C to 125 °C, and Digi-Key reports them identically, but E is only guaranteed from 0 °C with the rest assured by design [R-64]. A -40 °C design that picks an E-grade part on its operating range has no promise at -40 °C. This is the kind of distinction no distributor field can show. | active |
| D34 | 2026-09-11 | A decoded `packaging` is what the part number states about how the manufacturer ships the part. What a distributor stocks is `Offer.packaging`, and the two may disagree. | Both are true of different things: `AP62400WU-7` names a 7-inch reel and Digi-Key ships it in bulk. Reconciling them would destroy a fact rather than settle one. | active |
| D35 | 2026-09-11 | A parameter carries `conflicts`: the distributor values that disagree with it, each with its provenance and the id of the comparison rule. `Part` requires a parameter carrying one to have confidence `conflict`. | Task 11.3 says to record the distributor value on the parameter, and the M1 schema had nowhere to put it. Keeping it on the parameter means the part carries its own disagreement: a reader sees both numbers and where each came from, instead of a bare `conflict` badge and a lost value. | active |
| D36 | 2026-09-11 | A distributor attribute claims only what it names. `Control Features` yields a fact for each feature listed and none for the rest, where it previously yielded `false` for the rest. | A `false` from absence asserts that the part lacks the feature, and the field is a short description rather than an inventory. None of the 13 recorded Digi-Key regulators carries the field at all, so there is no evidence it is exhaustive. The cost of being wrong is a human called to arbitrate a Digi-Key omission; this is D24 applied to absence. | active |
| D37 | 2026-09-11 | Packages are compared as a shape family and a lead count, never as text, and `other` (a recognised shape outside the vocabulary) is distinct from null (nothing readable). Where a text names two families, a stated body width decides: 3.00 mm MSOP, 4.40 mm TSSOP, 3.90 mm SOIC. | `8-PowerSOIC (0.154", 3.90mm Width)` and `8-SOIC PowerPAD (DDA)` are one package written twice, so text equality would report a conflict on nearly every part. Collapsing `other` into null would let a BGA and a threaded cylinder agree. The widths are Digi-Key's own, and its supplier field corroborates the reading on 100-odd corpus rows. | active |
| D38 | 2026-09-11 | Observations of one parameter combine per parameter: `all` by default (one distributor disagreeing is a conflict even if another agrees), `any` for `package` (one agreeing description settles it). | Two distributors are two readings of one part, and a reading that disagrees is the whole point of reconciling. Digi-Key's `Package / Case` and `Supplier Device Package` are two descriptions of one thing, and its own two fields disagree on 9 of 547 recorded parts — DFN against QFN — so requiring both would escalate a distributor's internal inconsistency to a person. | active |
| D39 | 2026-09-11 | A temperature grade is the widest envelope the part's operating range covers completely (extended -40…125 °C, industrial -40…85 °C, commercial 0…70 °C), and a range covering none of them is undecided rather than forced into the nearest. | A 0 °C to 125 °C part does not reach industrial's -40 °C, and claiming it does is the error that matters; calling it commercial understates its top end but promises nothing false. The grade describes the range as stated, whatever it is referenced to, with `temperatureReference` kept on the parameter for the junction-against-ambient distinction a single word cannot carry. | active |
| D40 | 2026-09-11 | A tool asks whether an answer is free by running the real call under `cacheOnly`, which raises `CACHE_MISS` instead of fetching. Nothing predicts what is cached. | A prediction is a second implementation of the cache key, and two implementations of a key drift. Running the same path means the answer to "would this spend?" is produced by the code that would spend. It also keeps the question in one place: `withSpend` turns the miss into `needs_confirmation`, and every spending tool inherits that. | active |
| D41 | 2026-09-11 | `fetch_datasheet` is not gated by the quota policy; the distributor APIs are. | The gate exists for money and quota (D12). A manufacturer's PDF costs neither, and it is what every extraction reads; gating it would mean asking permission to do the main work. The fetcher's own retry, redirect and size limits are what keep it polite. | active |
| D42 | 2026-09-11 | The MCP server advertises the strict input schema it enforces (`additionalProperties: false`), which takes one cast because the SDK's registration type names a stripping object. | Advertised loose, the transport silently drops an argument the tool never agreed to ignore — the coercion this project refuses everywhere else. Strict at runtime is accepted by the SDK and refuses an unrecognised argument with the key in the message, which is a better answer than a silently different call. | active |
| D43 | 2026-09-11 | The MCP surface uses the v2 SDK (`@modelcontextprotocol/server`), and the in-process server is tested through the tool definitions rather than through a client. | The Agent SDK peer-depends on and bundles the 1.x line, so the server object it builds cannot be driven by a v2 client: an in-memory transport between them fails inside the SDK. Exposing `sdkTools()` and calling the handlers tests what actually matters — that every tool is present and behaves — without pinning the project to whichever line the Agent SDK bundles next. | superseded by D48 |
| D44 | 2026-09-11 | A parameter is nullable wherever a real datasheet may state something other than a number: `voutMax`, `ioutMax`, `quiescentCurrent`, `switchingFrequency`. A switching frequency may also be a one-sided bound (`QuantityBound`), a shape distinct from both a value and a range. | Reading twenty-one datasheets found all four. TI's TPS54331 gives the output limit as an equation in Vin, duty cycle and load; a controller such as LM5116 has no output current of its own; Infineon's IR3899 states no device quiescent current; LM5164's frequency is programmable and stated only as "up to 1 MHz". Recording a bound as a range would invent the end nobody stated, and as a value would assert a frequency the part does not run at (D24, on the datasheet side). | active |
| D45 | 2026-09-11 | `datasheetUrlOf` unwraps a distributor link that only points at the document: a `gotoUrl` parameter is followed, decoding repeatedly, and anything else is returned unchanged. | Digi-Key gives every Texas Instruments part an interstitial `suppproductinfo.tsp` page that serves HTML, so fetching it fails on content type; six of the thirteen recorded products are affected, and TPS62130's is encoded twice. The knowledge is Digi-Key's, so it belongs in the Digi-Key adapter rather than in the PDF fetcher. | active |
| D46 | 2026-09-11 | The golden set holds only parts whose datasheets can be fetched without scraping or defeating a bot wall. Texas Instruments, Diodes, Microchip and Infineon qualify; Monolithic Power Systems, ST, onsemi and Analog Devices do not. | `CLAUDE.md` forbids scraping and bot-wall evasion, and that rule does not stop at distributors. MPS returns an HTML viewer for every document URL, ST and Analog Devices refuse the request, onsemi redirects to a landing page, and Rohm blocks the referral link Digi-Key publishes while serving its own CDN fine. The plan asked for six manufacturers; four is what the rules allow, and the set says so rather than quietly meeting the number. | active |
| D47 | 2026-09-11 | The golden readings were made by this model, not by a person, and every file records that in `readBy`. The set is a baseline and a regression net, not an independent reference, until a person reviews it (Q6). | Measuring an automated extraction against a careful reading by the same model family cannot catch a misreading that comes from how the model reads. Saying so in the set itself is what stops a later eval score being read as more than it is. | active |
| D48 | 2026-09-11 | The Agent SDK's in-process server cannot carry a Zod record in a tool's input schema: the MCP 1.x SDK it bundles fails to convert one to JSON Schema, and one such tool empties the server's whole tool list rather than its own entry. `ask_human` takes labelled `{key, value}` pairs, which it stores as the record the escalation keeps, and a test lists the tools over a real connection. This supersedes D43: a v2 client drives the in-process server perfectly well — the schema was always what broke. | The model was given no tools at all and answered by writing its tool calls as prose. Nothing in the unit tests could see it, because calling a handler directly never converts a schema. One surface in two adapters means the surface must be expressible in both, and a test must exercise the conversion, or the next unconvertible schema silently costs a run everything again. | active |
| D49 | 2026-09-11 | The `PreToolUse` gate allows a spending tool through unchanged in a run that may not spend, so it answers from the cache and reports a miss as `needs_confirmation`. Only a call that asks to spend — `confirmSpend: true` — is denied. | Denying the tool outright would stop a no-spend run reading data already paid for, and rerunning a part for free is what the cache is for (D40). The gate is still absolute: the only way to spend is a run started with `--allow-spend`. | active |
| D50 | 2026-09-11 | A run carries a cost ceiling (`maxBudgetUsd`, default $2) as well as a turn limit, enforced by the harness on the model calls themselves. | The agent cannot reach it, which neither of the other two halves of the gate can say. The first real extraction stopped at $2 with the part stored and the classification still to do; the clean rerun cost $3.41. The ceiling is the difference between a run that overspends and one that stops (Q5). | active |
| D51 | 2026-09-11 | A `runs` row is written when a run starts and completed when it ends, and a batch skips a part whose latest run under the same prompt version finished, whatever it concluded. `--force` overrides. | A run that never came back is then visible as a row with no result rather than as nothing at all, and a batch of a hundred parts is restarted by running it again. Re-running a part that was already rejected would spend the same money to reach the same answer; that is the operator's call, not the batch's. | active |
| D52 | 2026-09-11 | `record_verification` takes what the reader read — the parameter, the verdict, the page, the quote — and the run stamps when it was read and which prompt and model read it. A context with no run refuses the call. | A model asked to stamp its own timestamp is a model inventing one, and a model asked to name its own version is a model that can name the wrong one. The two facts the system knows are the system's to record. | active |
| D53 | 2026-09-11 | A part written back after a verification pass carries that pass's verdicts in its aggregate. | Storing a part replaces its child rows. The first real verification run recorded thirty verdicts, wrote the part back to mark the parameters verified, and erased all thirty in the same call. The aggregate owns its verifications, so the pass has to hand them over with it. | active |
| D54 | 2026-09-11 | A verification run's result is a statement about the part: `verified` only when every value cited a page and every one was confirmed; `needs_human` when a page contradicted a value or a safety rating could not be found; `rejected` otherwise, with the reason naming how many of how many were confirmed. | A value not found on the page it cites is a provenance error, not a wrong value, and calling it a conflict would send a person to adjudicate a question nobody is asking. Saying "confirmed 29 of 30, 1 not found on the page it cites" says exactly what happened. | active |
| D55 | 2026-09-11 | An evaluation run gets a database of its own and a cache warmed beforehand by `scripts/warm-eval-cache.ts`. A part whose run asked for something uncached is reported as starved rather than scored. | The tool surface includes `get_part`: a run reading the answer out of an earlier run's work would score perfectly and measure nothing. And a score for a part whose datasheet was not on disk is a measurement of the cache, not of the prompt — so it is named rather than averaged in. | active |
| D56 | 2026-09-11 | A parameter fewer than three golden parts state is a health failure, not a score. Adding `LM2596S-3.3/NOPB` gave `voutFixed` its third example. | A parameter two parts state is measured on a sample of two: one lucky reading looks like a capability and one unlucky one like a defect. The check found it on the day it was written, and the answer was to read another datasheet rather than to lower the bar. | active |
| D57 | 2026-09-12 | The scorer compares a package by family and pin count, as reconciliation does, rather than by the words. A text naming no family, or one outside the vocabulary, falls back to exact equality. | The first baseline scored `package` correct on 1 part of 22: the golden set writes `6-TSOT26` where the datasheet writes `TSOT26`, and `20-HTSSOP (PWP)` where it writes `HTSSOP-20`. That measured spelling. A package has one canonical form in this project, and the scorer now says "correct" about the same things reconciliation says it about. | active |
| D58 | 2026-09-12 | An evaluation is resumable: `--resume <id>` reuses that evaluation's database and scores parts it already ran, except a run that made no tool call, which is re-run. | Two sweeps died to the harness's memory supervisor and a third to a subscription session limit, each after real money had been spent. A recorded run that called nothing never reached the part — a rate limit, a session limit, a crash at startup — so reusing it would score the harness rather than the prompt. | active |
| D59 | 2026-09-12 | The alternates query constrains output type as well as the axes the plan listed, and prices are compared in one currency, never converted. A part with no price in that currency is still offered, last. | The first real answer offered a fixed 5 V part as the cheapest alternate to an adjustable one: it covered the input range and the current, and it was not an alternate. Converting currencies would need an exchange rate this project does not hold, and a ranking built on a guessed rate ranks the guess. | active |
| D60 | 2026-09-12 | An alternate is offered only from parts a verification pass has confirmed, unless the caller passes `includeUnverified`. A part that needs a person, or was rejected, is never offered. | Recommending a replacement on the strength of an unchecked reading is how a wrong absolute maximum reaches a board. A part with a known conflict is not a recommendation at any price. | active |
| D61 | 2026-09-12 | `createdAt` and `updatedAt` belong to the store, not to the part: `upsert_part` takes a `PartDraft` without them and stamps both, keeping the original creation time when a part is stored again. | Three parts extracted after midnight Brisbane were stored with a `createdAt` of `2026-09-12T00:00:00Z`, which was five hours in the future in UTC. The verification pass then could not write them back at all — `updatedAt` cannot be earlier than `createdAt` — and the sweep died on the seventeenth part. A model asked for a timestamp writes the date it believes it is (D52, same rule for `checkedAt`). | active |
| D62 | 2026-09-12 | A batch records a part it could not run and carries on, rather than stopping. The part has no finished run, so a later resume picks it up. | The same crash cost sixteen good runs their sweep. One part that cannot be started is not a reason to abandon the other ninety-nine, and the resume rule already makes an unfinished part safe to retry. | active |
| D63 | 2026-09-12 | A web application is added as Module 19: a local HTTP server in this repository serving a React front end over the live SQLite store, the ledger and the evaluation results, with a read-only snapshot for sharing. | Six hundred and sixty parameters with page provenance, 2,505 ledger calls, 573 verification verdicts and an $87 evaluation cannot be read from a terminal, and every question worth asking of them — which parameter the prompt gets wrong, what a value cost, whether a run regressed — is comparative. The user's requirement is a complete site: where the CLI can do a thing, the site can too. | active |
| D64 | 2026-09-12 | The site may launch runs that spend money — extraction, verification, batch and evaluation sweeps — behind the three existing money gates (D12, D49, D50) plus a per-request cost ceiling and a confirmation naming the estimated figure. | The user's decision, taken against real numbers: an extraction costs $3.41 to $4.27, a verification $0.45 to $1.05, a full twenty-two-part sweep $87.24. A control surface that cannot start a run is not control, and the gates that make the CLI safe are the same ones here. | active |
| D65 | 2026-09-12 | Every write from the browser goes through one audited writer: actor, action, target, before, after, and a reason that is not optional. A human correction is stored beside the model's value, never over it. | The ledger exists because a tool call that is not recorded cannot be reconstructed (non-negotiable 4); a hand edit is no different, and is more dangerous because nothing else witnesses it. Keeping both values is what makes the golden set an independent reference rather than a rewritten one. | active |
| D66 | 2026-09-12 | The front end is React with Vite and a charting library, unit-tested under jsdom with Testing Library at the same 100% per-file coverage bar as the rest of `src/`. | The user's choice, taken over a zero-dependency vanilla build: virtualised tables over 2,505 ledger records and a dozen chart types are worth the dependency budget. The coverage bar does not move for the browser; a component that cannot be tested is a component written wrong. | active |
| D67 | 2026-09-12 | The server binds `127.0.0.1` unless `--host` is passed with a printed warning, mints a bearer token at every start that every write and every run launch must carry, and checks `Origin`. No credential value is ever serialised: health reports booleans. | The machine holds Digi-Key and Anthropic credentials and a button that spends money. A page open in another tab must not be able to reach either, and a token that changes per start cannot be pasted into a bookmark by accident. | active |
| D68 | 2026-09-12 | The shareable snapshot excludes credentials, `.env` values, datasheet text and page images, and the ledger blobs holding raw distributor responses. The exclusions are enforced in code and listed on the page itself. | Datasheet text and rendered pages are the manufacturers' copyright — the same reason `eval/golden/work/` is not committed — and a raw API response is the distributor's data, not ours to republish. A snapshot that leaks either is not shareable at all. | active |
| D69 | 2026-09-12 | The site reads any of the project's databases, the live store and every `data/eval-runs/*.sqlite`, selectable per request. | The twenty-two parts the baseline extracted live in an evaluation-run database, not in `data/chip.sqlite`, which holds two. A site that could only read the live store would show almost none of the work. | active |
| D70 | 2026-09-12 | Every part of the web module carries four test layers — unit, behaviour, snapshot, integration — and the site carries a fifth: Playwright driving Chromium against a real server on seeded temporary data. Snapshots are committed and reviewed as diffs. | The user's requirement, and the right one for a surface that is mostly rendering: 100% coverage proves every line ran, not that the page shows the right thing. A snapshot catches a payload that quietly changed shape; a browser test catches a chart that renders blank, a filter that stops filtering, and a dialog that spends money without asking. The browser never touches the live store: an end-to-end test that can delete real data is a test nobody dares run. | active |
| D71 | 2026-09-12 | Every pipeline job runs on the Rocky Linux 10 self-hosted runner, and the first job refuses to continue unless `/etc/os-release` says Rocky 10. Tools — poppler, Chromium's shared libraries, the GitHub CLI — are verified, never installed. Screenshot baselines are taken only on that runner and committed under `test/e2e/__screenshots__/rocky10/`; a local run writes to `local/`, which is git-ignored. | The target platform is one private VM, so "works on my machine" and "works on the build machine" are the same claim only if the build machine is checked. A package manager running unattended on that VM is not a build step, it is a change to the machine nobody reviewed. And a screenshot baseline is a photograph of one machine's fonts: taken here and compared there, it fails for reasons that have nothing to do with the page. | active |
| D72 | 2026-09-12 | The address is what names the database: the front end reads `?source=` when it is there, remembers it, and falls back to the selector otherwise. | Every endpoint already takes `?source=`, so an address could carry one and be ignored — and it was. A link to a part in the baseline opened the live store's copy of it with no sign that it had done so, which is the worst kind of wrong answer: the right page, the wrong two hundred numbers. | active |
| D73 | 2026-09-12 | The browser suite always starts its own server; it never reuses one that is already listening. | A `npm run web` over the real data directory answers `/api/ping` exactly as the seeded server does, so Playwright adopted it and ran thirty-three tests against live data — the one thing D70 forbids. Refusing to reuse turns a silent wrong target into a port-in-use failure. | active |
| D74 | 2026-09-12 | The site is written in sentence case, translates stored vocabulary into words on the way out, and shows every timestamp as how long ago with the exact local instant on hover. Identifiers stay exactly as they are stored. | Reading the running site, the all-lowercase copy read as a draft rather than a tool, and `needs_human` and `2026-09-11 11:03` are what the database calls things, not what a person calls them. The rule is one standard rather than a page-by-page judgement, because the mixture is what looks unfinished. | active |
| D75 | 2026-09-12 | The site authenticates with accounts: a username and a password (scrypt), a server-side session in an HttpOnly cookie, and optional single sign-on against any OIDC issuer. The token in the address is removed entirely, along with `--token`. | A token in a URL is in the shell history, the browser history, the referrer and any copy of the link, and it dies with the process that minted it — a restart signed every open tab out with eighteen red panels and no way back in. A session cookie is what the browser is for, and an account is what an audit row should name. | active |
| D76 | 2026-09-12 | Two roles. A viewer reads everything; an admin may correct values, answer questions, purge the cache, manage accounts and start runs that spend money. Enforced at the endpoint, not in the front end. | The site has a button that spends real money at a distributor and another that rewrites the golden set. Reading the data and changing it are different permissions, and the front end hiding a button is a courtesy, not a control. | active |

## 4. Status

Legend: **not started**, **in progress**, **complete** (all Definition of Done
items in `COMPLETION_PLAN.md` satisfied).

| Module | Name | Status | Completed on |
| ------ | ---- | ------ | ------------ |
| M0  | Foundation and tooling | complete | 2026-09-10 |
| M1  | Domain model and validation | complete | 2026-09-10 |
| M2  | Structured logging and tool-call ledger | complete | 2026-09-10 |
| M3  | Content-addressed cache | complete | 2026-09-10 |
| M4  | Persistence (SQLite) | complete | 2026-09-10 |
| M5  | Units, parsing, and normalisation | complete | 2026-09-10 |
| M6  | PDF toolkit | complete | 2026-09-10 |
| M7  | Digi-Key adapter | complete | 2026-09-10 |
| M7A | Part report generator | complete | 2026-09-10 |
| M8  | Mouser adapter | complete | 2026-09-10 |
| M9  | Nexar adapter with hard budget | deferred (D29) | |
| M10 | MPN resolution | complete | 2026-09-11 |
| M11 | Reconciliation and classification | complete | 2026-09-11 |
| M12 | Tool registry and MCP server | complete, bar 12.7 (Q3) | 2026-09-11 |
| M13 | Golden evaluation set | complete | 2026-09-11 |
| M14 | Agent runner (extraction) | complete | 2026-09-11 |
| M15 | Verification pass | complete | 2026-09-11 |
| M16 | Evaluation harness | complete | 2026-09-12 |
| M17 | Alternates query | complete | 2026-09-12 |
| M18 | Release and end-to-end sign-off | complete | 2026-09-12 |
| M19 | Web application | complete | 19A–19I; the site, the snapshot, and five test layers |
| M20 | Authentication | complete | accounts, passwords, sessions, roles, OIDC (D75, D76) |

## 5. Conventions

### Repository layout (target)

```
.
├── CLAUDE.md                 # the brief
├── docs/                     # this plan, the task list, the bibliography
├── src/
│   ├── config.ts             # environment validation
│   ├── core/                 # domain schemas and types (M1)
│   ├── log/                  # logger and tool-call ledger (M2)
│   ├── cache/                # cached() and cache stores (M3)
│   ├── db/                   # migrations and repositories (M4)
│   ├── units/                # parsing and normalisation (M5)
│   ├── pdf/                  # poppler wrapper (M6)
│   ├── adapters/             # digikey/, mouser/, nexar/ (M7-M9)
│   ├── mpn/                  # MPN normalisation and resolution (M10)
│   ├── reconcile/            # datasheet vs distributor (M11)
│   ├── classify/             # categorisation rules (M11)
│   ├── tools/                # transport-agnostic tool handlers (M12)
│   ├── mcp/                  # stdio MCP server adapter (M12)
│   ├── agent/                # runner, hooks, prompts (M14, M15)
│   ├── eval/                 # harness and scorer (M13, M16)
│   └── query/                # alternates search (M17)
├── bin/                      # tiny executable entry points
├── prompts/                  # versioned prompt files
├── eval/golden/              # hand-characterised parts
├── test/fixtures/            # recorded, sanitised API responses
├── test/live/                # opt-in live contract tests
├── ext/                      # git submodules (see D04)
├── data/                     # runtime cache, DB, ledger (gitignored)
└── scripts/                  # maintenance scripts (TypeScript, run with tsx)
```

### Code

- Tests are colocated: `foo.ts` has `foo.test.ts` beside it. Fixture-heavy
  tests may keep fixtures under `test/fixtures/`.
- Every exported function has a doc comment stating what it rejects and what
  it throws.
- Errors are typed classes extending one `ChipAgentError` base with a stable
  `code` string. No bare `throw new Error("...")` outside tests.
- No `any`, no `@ts-ignore`, no `eslint-disable`, no `.skip`, no `.only`, no
  `TODO`/`FIXME` in committed code. CI greps for all of these and fails.
- Coverage exclusions require a comment in the Vitest config giving the
  reason, and a row in the decisions table above.

### Adding a dependency

1. Prefer npm. Pin an exact version in `package.json`.
2. Add a row to `docs/REFERENCES.md` (what, URL, what we use it for).
3. If the library must be vendored or patched, add it as a submodule under
   `ext/<name>` with `git submodule add`, document why in the decisions table,
   and add the build step to `package.json` scripts.

### Prompts and models

- Prompt files are versioned: `prompts/extract.v1.md`, `prompts/verify.v1.md`.
  A change to prompt text is a new version, never an edit in place, so eval
  results stay comparable.
- Model IDs and effort are configuration, never hard-coded in handlers.

### Git

- Commit messages: imperative subject line, body explains why.
- Every commit is pushed straight away (D15).
- Docs changes are committed on their own, or alongside the code they
  describe, but never left unpushed.

## 6. Environment snapshot

Recorded 2026-09-10 on the development machine (WSL 2, Red Hat family
userland, Linux 6.18 kernel).

| Tool | Version | Note |
| ---- | ------- | ---- |
| Node | 22.23.1 | LTS line. |
| npm | 10.9.8 | Package manager (no pnpm installed). |
| gcc | 14.3.1 | Available for native modules if a prebuilt binary is missing. |
| poppler-utils | 24.02.0 | Installed 2026-09-10 via `dnf` (M0 task 0.1). `pdftotext`, `pdftoppm`, `pdfinfo` all report 24.02.0. |
| OS | Rocky Linux 10.2 | WSL 2 distribution. |
| GitHub CLI | authenticated as GavinMGlynn | Repo: `GavinMGlynn/cpu_datasheet_agent` (private). |

Library versions observed on npm the same day, to be pinned in M0:
`@modelcontextprotocol/server` 2.0.0, `@anthropic-ai/claude-agent-sdk` 0.3.267,
`zod` 4.6.1, `vitest` 5.0.0, `better-sqlite3` 13.0.3, `msw` 2.15.0,
`pdf-lib` 1.17.1, `fast-check` 4.9.0, `typescript` 7.0.2,
`typescript-eslint` 8.70.0, `eslint` 10.10.0, `prettier` 3.9.6, `tsx` 4.23.13.
Outcome of M0 task 0.3: `typescript` is pinned to 6.0.3 (D17). Installed and
pinned: `typescript` 6.0.3, `typescript-eslint` 8.70.0, `eslint` 10.10.0,
`@eslint/js` 10.0.1, `eslint-config-prettier` 10.1.8, `prettier` 3.9.6,
`vitest` 5.0.0, `@vitest/coverage-v8` 5.0.0, `zod` 4.6.1, `tsx` 4.23.13,
`simple-git-hooks` 2.14.0, `@types/node` 22.20.2.

## 7. Development log

Newest entry first. One entry per working session, or per significant docs
change. Never edit past entries; add a new one.

### 2026-09-12 — Session 25: a professional site, and real authentication

Two things came out of reading the running site rather than its tests.

**The look, and the words.** The site was lowercase throughout, which reads
as a draft; `main` had no `min-width: 0`, so a wide chart pushed the whole
grid past the window and the cards ran off the right-hand side; and the
datasheet reader rendered a page image nine hundred pixels below the button
that opened it, where it looked like nothing had happened. The design is now
a bench instrument — cool slate neutrals, hairline rules, a type scale,
tabular figures, one accent for what can be acted on — with both themes
re-validated against the chart palette (light `#ffffff`, dark `#161b22`,
every check passing). Sentence case everywhere, stored vocabulary translated
on the way out (`needs_human` reads "Needs a person"), timestamps as how long
ago with the exact local instant on hover, and the reader in a dialog with
Previous, Next and a page box that will not step past either end (D74).

**Authentication.** A token in an address is not authentication: it is in the
shell history, the browser history and every referrer, and it dies with the
process that minted it — a restart signed every open tab out with eighteen
red panels and no way back in. Module 20 replaced it (D75, D76):

| Piece | What it is |
| --- | --- |
| Accounts | `data/auth.sqlite`, separate from the parts store so a snapshot or a backup of the catalogue can never carry a password hash |
| Passwords | scrypt from `node:crypto`, N=2¹⁵, r=8, 32-byte key, 16-byte salt, parameters stored with the hash and upgraded at the next sign-in |
| Sessions | 32 random bytes in an HttpOnly `SameSite=Strict` cookie; only the SHA-256 is stored; twelve hours idle, seven days absolute, rotated on sign-in |
| Refusals | the same answer and the same scrypt work whichever half was wrong; five failures per account or address closes the door for fifteen minutes |
| Roles | a viewer reads everything; an admin changes things and spends money, checked at the endpoint |
| Single sign-on | any OIDC issuer, off until configured: discovery, PKCE, and the ID token verified against the issuer's keys in about a hundred lines rather than a dependency |
| Accounts CLI | `bin/chip-auth.ts` — add, passwd, role, disable, enable, bind, sessions, revoke, list; the password is typed at a prompt with the echo off or piped in, never an argument |

The handshake in flight is a row in `oidc_flows` rather than a signed cookie:
this installation already has somewhere to put short-lived server-side state,
and a row can be deleted the moment it is used, so a `state` is good once.

**What the build machine taught us.** The suite passed here and timed out
there. Two hundred isolated workers each asking for 32 MiB of scrypt is a
measurement of the runner, not of the code: four workers and a thirty-second
timeout under CI, unchanged locally.

**Next concrete step**

Q7 — which column of a MIN/TYP/MAX row is the value — and `extract.v2`
against the eval.

### 2026-09-12 — Session 24: Module 19 built, and what the site found

The web application, end to end: the server, the read models, the API, the
audited write path, run control, the front end, the snapshot, and the five
test layers D70 asks for. 3,070 tests, 100% coverage per file, 402 gate files
clean, 33 Playwright tests against a seeded temporary directory.

**What the site is**

A local server on the loopback interface with a token minted per start, a
React front end of eighteen pages, and a snapshot that is one file with the
charts drawn as SVG. Every read takes `?source=`, so the live store and any
evaluation-run database are read the same way; only the live store accepts a
write, and every write lands with an audit row in the same transaction. Runs
can be started from the page, under the three money gates the CLI uses plus a
ceiling for the launch.

**Driving it against the real data found four defects the tests did not**

| What was wrong | What it showed | Now |
| --- | --- | --- |
| Citations and verifications counted against parameters with no value | the live store reported 54 parameters stated and 60 pages cited; the baseline claimed 537 confirmations of 586 values | counted against values that exist: 54 and 54, and 476 confirmations |
| The spend chart bucketed by day | 47 runs inside one day drew a single point, which is exactly the shape an evaluation has | falls back to hourly buckets and names the bucket on the chart |
| `?source=` in the address was ignored | a link to a part in the baseline opened the live store's copy, silently | the address wins, and is remembered (D72) |
| Playwright reused whatever answered on port 5199 | a `npm run web` over the real data directory was adopted as the test server; 30 of 33 tests failed against data they should never have seen | the suite starts its own server or fails loudly (D73) |

The first of those is the one worth remembering: the wrong number was
produced by code that was fully covered, fully typed and passing every
assertion written about it. It was only visibly wrong once a person read a
page that said more pages were cited than parameters were found.

**What the baseline reads, through the site**

22 parts, 17 datasheets, 586 parameters stated, 476 confirmed by a second
pass; 47 runs, 981 turns, $109.33 — $4.97 a part, 18.7¢ a stated parameter,
4.6¢ a confirmed one. 922 tool calls, 1,101 gate decisions with no denial, a
2.3% cache miss rate over the 299 calls that could miss. The slowest tools are
the two that call the model (`extract_part` p50 219 s, `verify_part` p50
79 s); of the rest, `resolve_mpn` has a p90 of 1.9 s against a p50 of 13 ms,
which is the shape of a call that is usually cached and occasionally is not.
`normalise_value` failed nine times, every one `UNIT_PARSE_FAILED`. The
evaluation reads 90.6% recall, 90.6% precision, 59.3% exact citations, $87.24.

**The pipeline**

Every job runs on the Rocky Linux 10 self-hosted runner (D71): environment,
check, build, browser tests, release. The twenty-one functional browser tests
pass there. The twelve screenshot baselines are generated on that runner and
committed under `test/e2e/__screenshots__/rocky10/`, because a screenshot
baseline is a photograph of one machine's fonts.

**Next concrete step**

The plan is finished again. What the evidence suggests is Q7 — which column of
a MIN/TYP/MAX row is the value — and `extract.v2` against the eval, now that
the site makes the difference between two runs a page rather than a diff.

### 2026-09-12 — Session 23: Module 19 planned, a web application

The previous session ended when Claude and the WSL session both died. Nothing
was lost: the tree was clean at `a8e0df5`, `origin/main` matched it, and
`npm run check` came back green. One defect fell out of the restart —
Claude Code rewrites `.claude/settings.local.json` at every start in its own
JSON style, and `prettier --check` failed on it. The file is git-ignored and
tool-owned, so it is now in `.prettierignore` with the reason.

**The new requirement**

A complete web application over everything the project holds: the engineering
data and the statistics of the AI work that produced it. Four choices settled
it (D63 to D69): a local server plus a shareable snapshot; full run control
with the money gates enforced; full write-back under an audit trail; React
with a charting library. The instruction was explicit that no assumption
should limit what the site can do, so Module 19 mirrors the CLI's whole
surface rather than a reading of it.

**What the site has to work with**

| Source | What is there |
| --- | --- |
| `data/chip.sqlite` | 2 parts, 60 parameters, 8 offers, 30 verdicts, 6 runs |
| `data/eval-runs/dd212de6….sqlite` | the baseline: 22 parts, 660 parameters, 82 offers, 573 verdicts, 47 runs, 7 escalations |
| `data/ledger/2026-09-11.jsonl` | 2,505 tool calls, 7.3 MB, with inputs, outputs, errors, durations and transcripts |
| `eval/results/…extract.v1-claude-opus-5` | 90.6% recall, 90.6% precision, 59.3% exact citations, $87.24 |
| `data/cache/` | fourteen namespaces, every network call and rendered page |

That the baseline lives in an evaluation database and not the live store is
why D69 exists: the site reads either.

**Next concrete step**

19A.1 to 19A.8, the server foundation, then the read models in 19B.

### 2026-09-12 — Session 22: Module 18, and the plan is finished

**The end-to-end run**

One live-API extraction with spending allowed, on a part nothing had cached:
`TPS62740DSSR`. The gate confirmed `resolve_mpn` and `fetch_offers` on the
run's behalf, Digi-Key answered live, the datasheet came down fresh, and the
part was stored — then the $6 ceiling stopped the run on its last step, so it
is recorded as rejected with the part in the database. $6.16. That is the
money gate, all three parts of it, working on real traffic.

Then the verification pass over the twenty-two parts the baseline extracted:

| Measure | Value |
| --- | --- |
| Parts checked | 19 (three were already `needs_human`) |
| Values confirmed | 537 of 570 |
| Contradicted | 2 |
| Not found on the cited page | 4 |
| Unchecked | 27 (22 of them one part that hit its cost ceiling) |
| Parts now `verified` | 8 |
| Cost | $22.09 |

Scoring afterwards is unchanged at 90.6% recall: verification confirms values,
it does not correct them.

**Two defects, both found by running it**

The sweep died on its seventeenth part. Three parts extracted after midnight
Brisbane carried a `createdAt` five hours in the future, because the model
wrote the timestamp, and nothing can be updated before it was created. The
store owns those timestamps now (D61) — the same rule as `checkedAt` (D52) —
and `upsert_part` keeps the original creation time when a part is stored
again. The three stored parts were repaired in place, recorded here because
that is data changed by hand.

The second defect was the first one's blast radius: one part's failure ended
the sweep and cost sixteen good runs their batch. A batch records the part it
could not run and carries on (D62).

**What the sweep says about the pipeline**

Three of the four "not found" verdicts are the same thing: `feedbackAccuracy`
is arithmetic on two stated limits, so no page states it and no reader can
confirm it. That is L1 in the new known-limitations table, and the fix is to
call the provenance `derived` rather than `datasheet`. The two contradictions
are both "the page states it, but not for this orderable". Seven limitations
are recorded with the evidence that found them (section 9).

**Done, and what is left**

Every task in `COMPLETION_PLAN.md` is checked except Module 9 (Nexar,
deferred by D29) and task 12.7, which waits on a file only the user has (Q3).
Every reference row is verified or carries the reason it is not. 2266 tests,
100% coverage, zero warnings, tagged `v1.0.0`.

Total spent on real runs across the project: about $135, nearly all of it the
M16 baseline and this sweep.

### 2026-09-12 — Session 21: Module 17 complete

**Done**

- `findAlternates` answers the question the project was built for, over stored
  parts only: no model, no network, nothing spent. Constraints filter, price
  ranks, and anything left out is listed with the reason.
- `find_alternates` on the tool surface and `chip-run alternates <mpn>` on the
  command line, with `--vin`, `--iout`, `--qty`, `--currency`, `--output`,
  `--limit` and `--include-unverified`.
- Every candidate carries `pinCompatibility: 'not_assessed'`, and every
  rendered answer ends with the disclaimer — including the ones with nothing
  to offer.
- 2262 tests, 100% coverage, zero warnings.

**The first real answer changed the schema**

Run against the twenty-two parts the baseline extracted:

```
TPS54331DR — AUD 1.40 each at 100+ (digikey 296-26991-1-ND)
1. AP63205WU-7 — AUD 0.73 each at 100+  48% cheaper
   ...
   voutFixed: null → {"value":5,"unit":"V"}
```

It covered 8–28 V at 2 A and cost half as much, and it is a fixed 5 V part
where the reference is adjustable. Nobody swapping a TPS54331 for it would
get a working board. The constraint list gained `outputType` (D59); with
`--output adjustable` the answer becomes AP63357DV-7 at 42% cheaper, which is
a real suggestion.

**Learned**

- **A filter list is only as good as the first real question.** Five
  constraints from the plan and the answer was still wrong, because the one
  that mattered for this part was not among them. The comparison table showed
  it — which is why the answer lists every difference rather than summarising.
- **Ranking is where a guess would hide.** Converting currencies would need an
  exchange rate this project does not hold, so a part with no price in the
  currency asked about is offered unranked rather than converted or dropped.

**Next**

- M18: release and end-to-end sign-off.

### 2026-09-12 — Session 20: Module 16 complete, and the first baseline

**Done**

- `runEval` takes every golden part through a real extraction and scores what
  it stored, with a report in JSON to compare against and Markdown to read.
  Every run is a no-spend run and every run gets a database of its own (D55).
- `compare` flags anything that scored worse between two runs, including a
  value that stayed right while its citation drifted. `replay` rebuilds a run
  from the ledger. `health` checks the measurement rather than the extraction.
- `scripts/warm-eval-cache.ts` fills the cache through the same tools the
  agent uses, so an evaluation is offline except for the model calls.
- M13 reopened: the health check refused the set as it stood, so the set now
  holds a twenty-second part (D56).
- 2226 tests, 100% coverage, zero warnings.

**The baseline**

`extract.v1` on `claude-opus-5` at effort high, all twenty-two parts:

| Measure | Value |
| --- | --- |
| Parts extracted | 22 of 22 |
| Recall | 90.6% |
| Precision | 90.6% |
| Citations exact | 59.3% |
| Citations one page out | 13.2% |
| Cost | $87.24 over 355 turns |

Committed under `eval/results/2026-09-11T16-00-31-043Z-extract.v1-claude-opus-5/`.

Where it is weak, in order: `maxDutyCycle` 5 of 14, `switchingFrequency` 14 of
22, `voutMax` 12 of 17, `minOnTime` 12 of 17, `feedbackAccuracy` 16 of 22.
Nearly all of those are one disagreement wearing five hats — which column of a
MIN/TYP/MAX row is the value (Q7). Citations are the weakest number by far:
the value is right and the page is a section away.

**Learned**

- **The first score was the scorer's.** `package` came back correct on one
  part in twenty-two, because the golden set writes `6-TSOT26` and the
  datasheet writes `TSOT26`. Reconciliation had compared packages by family
  and pins all along; the scorer was comparing spelling (D57). Re-scoring cost
  nothing — the runs were already recorded — and recall went from 87.0% to
  90.6%.
- **A long eval needs to survive its own environment.** Two sweeps were killed
  by the machine's memory supervisor and a third hit a subscription session
  limit three parts from the end. Resume (D58) turned each of those from "pay
  again" into "carry on", and the rule that a run which called nothing did not
  happen is what made the session-limit failures re-runnable.
- **A schema change needs a migration even for a field nobody has read.**
  Adding `cacheMisses` to the run details made every run recorded before it
  unreadable, in the middle of a sweep. Migration 0003 backfills them with the
  zero they would have counted.
- **The evaluation is the cheap part of iterating, and it is not cheap.**
  $87 for twenty-two parts, $4 each, dominated by holding datasheet pages in
  context and writing the parameter set out twice. That is the number to
  improve before the next sweep, not after.

**Next**

- M17: the alternates query — "find a cheaper part that still meets my Vin
  range", with the pin-compatibility caveat stated every time.

### 2026-09-11 — Session 19: Module 15 complete

**Done**

- `verifyPart` checks every stored value against the page it cites, in a run
  that has never seen the extraction. It gets three tools — `read_pages`,
  `render_page`, `record_verification` — and cannot store a part, fetch
  anything, or raise a question. What happens to the part is decided
  afterwards, deterministically, from the verdicts.
- `prompts/verify.v1.md`: confirmed, contradicted, or not found, with a quote
  for the first two and nothing to quote for the third. It says what a
  confirmation is not: consistent with, implied by, or stated on another page.
- `applyVerdicts`: confirmed becomes `verified`, contradicted becomes
  `conflict` and raises a question, and `not_found` on a safety rating is
  treated as a contradiction. A value a distributor disagrees with is never
  promoted, whatever the page says.
- `record_verification` now takes only what the reader read; the run stamps
  when, which prompt and which model (D52).
- `executeRun` holds everything the two kinds of run share, so the gate, the
  run row and the ledger tree are the same for both by construction.
- `chip-run verify <mpn>` and `chip-run verify-pending`.
- 2170 tests, 100% coverage, zero warnings.

**The pass found a real error on its first real run**

TPS54331DR, 33 turns, 32 tool calls, $0.45 — a seventh of what extracting it
cost, because a page is read once and a verdict is short.

29 of 30 values confirmed. The one it could not find was `topology`, which the
extraction cited to page 9. The golden set has it on page 1, in the opening
sentence of the datasheet. Two independent readings, neither of which saw the
other, agree that the citation was wrong — which is precisely what a
verification pass is for, and it found it the first time it ran.

**And it found one of my own**

The first attempt reported 29 confirmed and left the database with no verdicts
at all. Storing a part replaces its child rows, and the pass wrote the part
back to mark the parameters verified — erasing the thirty verdicts it had just
recorded, in the same call. The aggregate owns its verifications, so the pass
hands them over with the part now (D53). A test asserts the rows survive.

**Learned**

- **Verification is cheap.** $0.45 against $3.41. The expensive part of
  extraction is holding pages of datasheet in context while reasoning about
  them; checking one claim against one page is a much smaller question.
- **A wrong citation is invisible to extraction and obvious to verification.**
  The value was right, the page was wrong, and nothing in the extraction run
  could have noticed. This is the whole argument for the second context.
- **"Not found" is not "contradicted".** Sending a provenance error to a
  person as a conflict would ask them to adjudicate a question nobody is
  asking (D54). The run says what it did: 29 of 30, one not on its page.

**Next**

- M16: the evaluation harness — the golden set end to end, scored per
  parameter, with the prompt iterated against the score rather than against
  intuition.

### 2026-09-11 — Session 18: Module 14 complete

**Done**

- `src/agent/`: `extractPart` takes one part number through a headless run on
  the Agent SDK — the tool surface as an in-process MCP server, no built-in
  tools, no settings files, a turn limit, a cost ceiling and the `PreToolUse`
  money gate — and records what happened.
- `prompts/extract.v1.md`: the system prompt, snapshotted, with a test that
  every tool it names exists.
- The money gate (D12) is three parts now: the `spendsQuota` flag the registry
  enforces, the hook that denies a spend the run was not given a budget for,
  and `maxBudgetUsd` on the harness itself (D50). The hook's decisions are
  recorded in the ledger with the harness's tool-use id.
- `runs` rows (M1 and M4 reopened for the `Run` schema and its repository):
  written at the start, completed at the end, with the turns, the cost, the
  result and what the run did. `extract-many` is resumable off them (D51).
- `bin/chip-run.ts`: `extract <mpn>` and `extract-many <file>`, with
  `--model`, `--effort`, `--max-turns`, `--max-cost`, `--prompt`,
  `--allow-spend` and `--force`.
- 2135 tests, 100% coverage, zero warnings.

**The first real run found the module's own bug**

The run cost three cents and called nothing. The model had written its tool
call as prose, which is what a model does when it has no tools — and the
in-process server reported itself connected. `tools/list` was throwing
`Cannot read properties of undefined (reading 'push')` inside the MCP 1.x SDK
the Agent SDK bundles, because `ask_human` took a Zod record and that
converter cannot express one. One unconvertible tool costs the run every tool
on the server, not just that one (D48).

Two things follow. The tool takes labelled pairs now, and stores them as the
record the escalation keeps. And the test that would have caught it exists:
the in-process server is listed and called over a real connection, which also
disproves D43 — a v2 client drives the bundled v1 server perfectly well, and
the schema was always what broke. Every unit test passed throughout; none of
them ever converted a schema.

**Then it worked**

`TPS54331DR`, no spending allowed, everything from the cache: resolved the
part number, read the offers Digi-Key had already given us, fetched the
datasheet, found its sections, read twelve pages, reconciled against the
distributor facts, classified, and stored the part. 18 turns, 17 tool calls,
$3.41.

Scored against the golden file by the M13 scorer: **recall 92%, precision
92%, citations exact 63%**. The two disagreements are not misreadings —
both are min/typ/max columns where the golden reading and the run chose
differently (Q7). The citations are the weaker number: values right, page
often one section away from the page the golden set names.

**Learned**

- **A connected server is not a server with tools.** The status said
  connected, the tool count in the CLI's own init message was zero, and the
  model filled the gap by inventing tool-call syntax in prose. Nothing short
  of listing the tools over the wire would have shown it.
- **The gate does what it is for.** The run asked `resolve_mpn` to spend,
  was refused, said "Resolution would spend quota, which this run may not do.
  Let me check what's cached", and carried on from the cache. That sentence is
  the whole design working.
- **Budget is a real constraint, not a formality.** The first clean attempt
  hit the $2 ceiling on its last step, after storing the part — the model
  even said it was going straight to storing because the budget was nearly
  gone. Datasheet pages are expensive to hold in context.

**Next**

- M15: the verification pass, in a fresh context, checking each stored value
  against the page it cites.

### 2026-09-11 — Session 17: Module 13 complete

**Done**

- Twenty-one parts in `eval/golden/`, each read page by page: every
  parameter with the page it came from, every null with a note saying what
  the page holds instead, the classifications derived by hand, and what the
  part number should decode to.
- `scripts/prepare-golden.ts`: fetches a datasheet through the cache, maps
  its sections, writes the pages worth reading, renders a page on request and
  finds a phrase across the document.
- `src/eval/`: the `GoldenPart` schema, the loader, and the scorer —
  per-parameter correct/wrong/missing/extra/absent with citations scored
  separately, and set-level precision, recall and provenance accuracy.
- `test/eval/golden-set.test.ts` validates every file against the schemas,
  the citations against the page counts, the classifications against the
  rules, and the decoders against the ordering tables.
- 2002 tests, 100% coverage, zero warnings.

**Learned**

- **Reading twenty-one datasheets corrected the schema four times.** An
  output maximum can be an equation, a controller has no output current, a
  quiescent current is not always specified, and an adjustable frequency is
  often "up to 1 MHz" with no lower end. Each is now nullable or has a shape
  of its own (D44). No amount of thinking about the schema found these; one
  afternoon of reading found all four.
- **Text extraction swapped two values that matter.** The TPS62130 electrical
  table interleaves the high- and low-side on-resistance rows, so the text
  reads 40 mΩ where the datasheet says 90 mΩ. The rendered page is what
  caught it, which is exactly the gotcha `CLAUDE.md` names — and it means 23
  values in the set carry `method: "image"`.
- **Half the industry will not serve a PDF to a plain client.** MPS returns an
  HTML viewer, ST and Analog Devices refuse, onsemi redirects. The set holds
  four manufacturers rather than six because the alternative was defeating a
  bot wall (D46).
- **Digi-Key's datasheet link is often not the datasheet.** Every TI part gets
  an interstitial page whose `gotoUrl` holds the document, sometimes encoded
  twice (D45), and `LT8610AEMSE-PBF` points at the LTpowerCAD help file
  instead of the part's datasheet.
- **The set measures what it can.** These readings are the model's, not a
  person's, so the eval is a regression net rather than an independent
  reference until someone reviews it (D47, Q6).

**Next**

- M14: the agent runner on the Agent SDK, with the money-gating hook.

### 2026-09-11 — Session 16: Module 12 complete

**Done**

- `src/tools/`: the registry (validated in, validated out, ledgered), the
  quota policy, and all eighteen tools the plan names, with a composition
  root that wires one context from configuration.
- `src/mcp/`: the stdio server, the in-process server for M14, one shared
  result mapping, and `bin/chip-mcp.ts`.
- Reopened M1 (a partial parameter schema), M2 (the ledger drops undefined
  from inputs and outputs), M3 (`cacheOnly`), M7/M8 (`cacheOnly`,
  `withOptions`, cache keys on lookups, Mouser's currency) and M10 (a cache
  miss is not a distributor failure).
- Checked by hand: `bin/chip-mcp.ts` driven over real pipes through
  initialize, `tools/list` (18 tools) and `tools/call` (`get_part`), with
  the logs on stderr and only protocol frames on stdout, stopping cleanly on
  SIGINT. `.mcp.json` added so Claude Code offers it as a project server.
- 1925 tests, 100% coverage, zero warnings.

**Learned**

- **"Is this cached?" must not be a second implementation.** The first design
  was a probe that rebuilt the cache key to predict a hit. Running the real
  call under `cacheOnly` instead means the prediction and the call cannot
  disagree, and it put the whole question in one helper (D40).
- **A loose schema is a coercion.** Advertising the stripping object the SDK's
  type asks for means a client's unknown argument is dropped and the call runs
  as if it had never been sent. One cast buys `additionalProperties: false`
  and a refusal that names the key (D42).
- **The two SDKs are on different major lines.** The Agent SDK bundles the 1.x
  MCP SDK, so the in-process server cannot be driven by a v2 client at all —
  an in-memory transport between them fails inside the SDK. Testing the tool
  definitions directly proves the thing that matters without pinning us to
  their choice (D43).
- **A tool that answers with an optional field it has nothing to put in broke
  the ledger.** `undefined` is not JSON, and the record schema rejected it;
  Mouser listings carry no datasheet URL, so the first Mouser candidate to
  reach a tool result failed the call it was recording. The ledger now drops
  undefined from inputs and outputs as it already did for errors (D28).
- A flaky coverage result had the same shape as session 15's: a path that only
  runs when the machine is fast enough. Both times the fix was to test the
  thing directly rather than through timing.

**Next**

- M13: hand-characterise twenty parts as the golden set, before anything
  trusts an extraction.

### 2026-09-11 — Session 15: Module 11 complete

**Done**

- `src/reconcile/`: per-parameter policy (tolerance, safety, how several
  observations combine, and why each tolerance is what it is), comparison
  rules for every pairing of a stored value with a distributor's, and a
  driver that records conflicts on the parameter, sets confidence, and
  escalates the safety ones.
- `src/classify/`: eight named, versioned rules producing every axis, a
  package-text parser shared with reconciliation, and `classify` /
  `tryClassify` — all axes or a typed error naming what could not be decided.
- Reopened and re-verified M1 (the `conflicts` annotation and the value-shape
  guards), M4 (migration 0002), M5 (facts stored as observed; control
  features claim only what they name), M7 (a flaky coverage path made
  deterministic) and M7A (conflicts shown in the report).
- 1772 tests, 100% coverage, zero warnings.

**Learned**

- **Digi-Key contradicts itself, and the corpus shows where.** Its two package
  fields disagree on 9 of 547 recorded parts: `Package / Case` says DFN where
  `Supplier Device Package` says QFN, for MPS `GQ`/`DQ` parts and three ST
  `L59xx`/`L79xx` parts. The M10 decoder reads those same codes as QFN, so
  two of three readings agree — and requiring both fields to agree would have
  escalated a distributor's internal inconsistency to a person (D38).
- **A false from absence is an invented fact.** The `Control Features`
  mapping turned an unlisted feature into `false`, which would have put parts
  into `needs_human` over a Digi-Key omission. No recorded regulator carries
  the field at all, so nothing was lost by claiming only what it names (D36).
- **A tolerance is a judgement that has to be written down.** `voutMax` needs
  ten percent because Digi-Key publishes a duty-cycle-limited maximum
  (17.28 V against an 18 V input) where the datasheet states a regulation
  range; temperatures need none, because grades are whole degrees and a
  difference is a junction range against an ambient one. Every policy row
  carries its reason so a bad call is arguable from the data rather than the
  code.
- **The plan's word "provenance" in task 11.3 had nowhere to go.** Recording a
  distributor's disagreeing value needed a field the M1 schema did not have,
  so M1, M4 and M7A were reopened rather than the value being dropped into an
  escalation and lost (D35).
- A flaky coverage failure surfaced under a loaded full-suite run: the real
  `setTimeout` path is only reached when a request finishes inside the
  throttle's minimum interval. Exporting the helper and testing it directly
  makes the check deterministic.

**Next**

- M12: the tool registry and the MCP server, over stdio and in process.

### 2026-09-11 — Session 14: Module 10 complete

**Done**

- `src/mpn/`: `normaliseMpn`, a declarative decoder engine, eight
  manufacturer decoders, candidate gathering across both distributors,
  matching with `ambiguous_mpn` escalation, and datasheet family linking.
- The corpus grew from 469 to 576 real part numbers so that every decoder
  group has at least thirty (Richtek had six, Microchip six, ST thirteen).
  571 of the 576 decode; the five that do not are listed by name in the
  corpus test with the reason nobody can read them.
- 1564 tests, 100% coverage, zero warnings.

**Learned**

- **The corpus can confirm a wrong claim.** Checking 466 package families and
  277 pin counts against Digi-Key's own fields passed clean, and then TI's
  packaging guide [R-62] showed that `D` is SOIC in 8, 14 *and* 16 leads,
  `DBV` is SOT-23 in 5 and 6, and `RHL` is a 24-lead VQFN where Digi-Key
  reports 14. A code that happens to appear on one pin count looks fixed. Four
  pin-count claims were removed (D32).
- **Two grades that look identical are not.** Digi-Key reports Analog Devices
  E and I parts as -40 to 125 °C alike, but an E part is only guaranteed from
  0 °C [R-64]. `TemperatureGrade` now carries the tested range separately
  (D33). No distributor field could have shown this.
- **Greedy variant groups quietly eat markers.** Read greedily, the `Q` of
  `TPS5430QDDARQ1` becomes a version letter rather than the automotive
  marker, and the `P` of `NCV890200PDR2G` leaves `D` behind, putting an
  exposed-pad SOIC part in a plain SOIC. Four decoders had this bug; the unit
  tests caught two that the corpus report had not, because both readings
  decode.
- **The version letter is part of the identity, not the packaging** (D31).
  This is the plan's one wrong assumption about MPN resolution.
- MPS `-Z` and `-P` are reel sizes [R-65], not the opaque markers they were
  first recorded as; they now decode as `reel`.

**Next**

- M11: reconciliation and classification.

### 2026-09-10 — Session 13: element14 assessed, key held

**Done**

- Registered key stored and verified live. `FARNELL_API_KEY` and
  `FARNELL_STORE` added to the config, with the key redacted from logs and the
  ledger like every other credential.
- Recorded a part-number corpus of 469 real MPNs across eight manufacturers,
  each paired with Digi-Key's own base product number, package and packaging,
  so the M10 decoders can be verified against an independent source.

**Learned**

- **My earlier recommendation was partly wrong and the data corrected it.** I
  argued for element14 on AUD pricing and datasheet links. It gives neither:
  the Australian store lists 2 of 5 sample parts, there is no datasheet field
  in the response at all, and prices come in the store's currency.
- What it does give is real: 32 electrical attributes for TPS54331DR, against
  Mouser's zero. It is the only free second parametric source found so far,
  for the subset of parts it lists (D30).
- The M10 corpus shows suffixes decompose far less cleanly than the plan
  assumed. `TPS54331DDAR` runs a version letter, a package code and a reel
  code together; `LT8610ABEMSE-3.3#TRPBF` also encodes a fixed output voltage;
  the same Diodes suffix maps to two different packages. The decoders will
  claim only what the corpus proves, which is what task 10.2 already demands.

**Next**

- Finish M10: normalisation, conservative decoders, candidate matching, and
  family detection.

### 2026-09-10 — Session 12: Nexar costs checked, Module 9 deferred

**Done**

- Checked the Nexar plan comparison rather than assuming the note in
  `CLAUDE.md`. The finding changes the plan: datasheets and tech specs are
  included only in the free Evaluation tier and in Enterprise. Standard and
  Pro carry pricing and availability alone.
- Deferred M9 and recorded why (D29). Work continues at M10.

**Learned**

- The paid Nexar tiers strip exactly the field this project would have paid
  for. Digi-Key already returns a datasheet URL with 1000 free calls a day, so
  a Standard subscription would buy less than we have.
- The 100-part Evaluation allowance is lifetime, not monthly, so it is best
  spent proving a specific need rather than on routine lookups.

**Next**

- M10 (MPN resolution), now unblocked with both distributors built and both
  returning sibling part numbers.

### 2026-09-10 — Session 11: Module 8 complete

**Done**

- `src/adapters/mouser/`: request layer with the key as a query parameter and
  an explicit check for the `Errors` array, response schemas validated against
  live data, mapping to one offer per listing with formatted-price parsing and
  sibling part numbers, and cached, ledgered operations with `lookup`.
- 15 fixtures recorded across 14 parts (13 listed, one not) plus a keyword
  search. Live contract test passes, including an assertion that Mouser still
  publishes no parametrics so the day that changes is noticed.
- 1439 tests, 100% coverage, zero warnings.

**Learned**

- Mouser's Search API returns **only packaging attributes** for switching
  regulators, and a datasheet URL for one part in thirteen. It is a price and
  availability source, not a parametric one (D27). The speculative Mouser
  mapping table written in M5 from guesswork has been emptied.
- **A rejected request returns HTTP 200** with an `Errors` array, so status
  alone never means success. This is why the first key failed silently at the
  transport level while looking like a successful call.
- Mouser prices are formatted strings (`"$1.62"`) in the account's currency,
  which is USD here while Digi-Key is configured for AUD. Any comparison must
  filter by currency rather than assume one.
- Mouser lists one SKU per part with the packagings it offers as attributes,
  where Digi-Key lists one SKU per packaging. A listing offering several
  records `unknown` rather than picking one.
- **A real bug the ledger caught**: an error detail holding `undefined` made
  recording throw, so the caller saw a validation failure instead of the
  failure being recorded. Fixed at both ends (D28).

**Next**

- M9 (Nexar adapter with the hard budget). Nexar credentials are needed, and
  the evaluation tier allows 100 parts for the lifetime of the account, so it
  stays disabled by default.

### 2026-09-10 — Session 10: report generator, Mouser unblocked

**Done**

- `src/report/`: `renderPartReport` produces a standalone page for one part,
  with every parameter beside its source and confidence, the cited datasheet
  pages beside the values taken from them, offers with price breaks,
  classifications with their rules, and verifications. Output is a `title`, a
  `style` and body markup with no document wrapper, which a browser renders
  from a file and the artifact publisher accepts unchanged.
- `collectPageImages` renders each cited page to a data URI so a report is one
  file. `selectBestPrice` moved into core so the report and the offer
  repository share one definition rather than two.
- 1355 tests, 100% coverage, zero warnings.

**Learned**

- Answering "do we need a web site" honestly meant separating three different
  viewing jobs. Only checking an extraction against its page wants a rendered
  page; escalations want a prompt that records who answered, and eval
  comparison already has a report planned in M16 (D26).
- The first Mouser key supplied was for the Order and Cart APIs, which are a
  separate registration from the Search API and were still pending
  authorisation. The Search API key arrived separately and works.
- Mouser returns **HTTP 200 with an `Errors` array** for a rejected key, so
  the adapter cannot judge success by status code alone. That shapes M8's
  request layer.

**Next**

- M8 (Mouser adapter), now unblocked. Endpoints confirmed live:
  `POST /api/v1/search/partnumber` and `POST /api/v1/search/keyword`, with the
  key as an `apiKey` query parameter.

### 2026-09-10 — Session 9: Module 7 complete, architecture document added

**Done**

- `docs/ARCHITECTURE.md` describes the system: the two layers and why they are
  split, the per-part pipeline, what each module owns, and the seams. A
  rendered version with the diagrams drawn is published as an artifact and its
  source is committed as `docs/architecture.html`.
- Digi-Key credentials (production and sandbox) verified against their own
  token endpoints. The config now holds both pairs and selects by
  `DIGIKEY_SANDBOX`, since each host rejects the other's pair. Both are
  redacted from logs and the ledger.
- `src/adapters/digikey/`: token client with refresh-ahead, paced request
  layer with retry and quota tracking, loose response schemas validated
  against live responses, mapping to offers and parametric facts, and cached,
  ledgered operations with a `lookup` that answers in one request what would
  otherwise take three.
- 27 fixtures recorded from the live API across 13 parts and 6 manufacturers,
  plus a keyword search and a part Digi-Key does not list, all sanitised of
  account fields. Live contract test passes. 1303 tests, 100% coverage, zero
  warnings.

**Learned**

- The Digi-Key access token lives 600 seconds, so refresh-ahead is mandatory
  rather than an optimisation.
- Product details already carries pricing, parametrics and the datasheet URL,
  so `lookup` spends one request instead of three.
- Real data drove two design decisions (D24): `Up to 1MHz` is a stated bound,
  and `Both` is inconclusive. Both were found by parsing 13 real parts, not by
  reading documentation.
- Two schema shapes were wrong until checked against live responses:
  `AlternatePackagings` wraps its array in an object with leaner items, and
  `BaseProductNumber.Name` is absent on some keyword results (D25).
- **A test-quality bug worth remembering**: msw converts an exception thrown
  inside a handler into a 500 response, so two tests that claimed to exercise
  transport failure were exercising the 5xx retry path and passing for the
  wrong reason. Use the helper's `networkError()` for a real dropped
  connection. The coverage gate is what surfaced it.

**Next**

- M8 (Mouser adapter). Its endpoint paths still need confirming (task 8.1);
  the pages timed out when first checked. A Mouser API key is needed before
  fixtures can be recorded.

### 2026-09-10 — Session 8: Module 6 complete, CI moved to the self-hosted runner

**Done**

- CI now runs on the user's self-hosted runner (`[self-hosted, Linux, X64]`,
  D21). It verifies poppler rather than installing it, cancels superseded
  runs, and suppresses git's default-branch hint through job environment
  variables. First run green in 1m48s on runner `localhost`.
- `src/pdf/`: the subprocess wrapper (timeout, output cap, typed failures,
  injectable spawner), `popplerPreflight`, `fetchPdf` (redirects, retries with
  backoff, size caps, content-type and magic-byte checks, all through the
  cache), `PdfToolkit` with `pdfInfo`, `readPages`, `renderPage`, `allPages`,
  and `findPages`, page shape metrics, and the section patterns.
- Test fixtures are generated with `pdf-lib` at test time, so poppler is
  exercised for real without committing a datasheet. HTTP is served by msw.
  1153 tests, 100% coverage, zero warnings.

**Learned**

- msw's request-handler types do not resolve under type-aware linting while
  `tsc` accepts them, which also meant an earlier typecheck had passed
  vacuously. All msw usage now goes through one boundary module (D22).
- `pdftotext -f N -l N` exits 99 for a page the document does not have, so
  the toolkit checks the page count first and raises
  `PDF_PAGE_OUT_OF_RANGE` instead of an opaque subprocess failure.
- Two real bugs the coverage push surfaced: `pdfinfo` field parsing used
  `\s+`, so an empty `Title:` absorbed the next line; and the fake child
  process in a test emitted `close` before stream data was delivered, which
  is not how a real process behaves.
- Guarded helpers replaced dead `?? ''` fallbacks (D23).

- CI run 34461457662 green on runner `localhost`. M6 complete.

**Next**

- M7 (Digi-Key adapter) is blocked on credentials, open question Q1. Tasks
  7.1 to 7.5 (token client, request layer, endpoint record, response schemas,
  operations) can be written without them, but 7.6, 7.7, and 7.9 need live
  calls to record fixtures, and a module is not complete until every task is.
  Waiting for the answer rather than leaving a half-built module.

### 2026-09-10 — Session 7: Module 5 complete

**Done**

- `src/units/`: text normalisation, unit alias and prefix table,
  `parseQuantity` / `parseRange` / `parseTemperatureRange` with exact
  decimal scaling, canonical and engineering formatters, tolerance-based
  comparison, and the Digi-Key and Mouser parametric mappers with
  `parseDistributorValue` producing schema-keyed facts.
- 277 new tests including fast-check round-trip properties for every unit.
  Total about 1015 tests, 100% coverage, zero warnings.

**Learned**

- Build numbers from decimal text plus a prefix exponent
  (`Number("70e-6")`) instead of multiplying; multiplication gives
  `7.000000000000001e-05` and breaks exact round trips.
- `+/-` must be stripped before range detection because `/` is also a range
  separator.
- Task 5.7 is complete against the parametric names known today and is
  explicitly reopened when M7 and M8 record fixtures (see the module README).

- Chased branch coverage from 98.8% back to 100% honestly: the gaps were
  dead `?? ''` fallbacks on regex groups that always participate, forced by
  `noUncheckedIndexedAccess`. Replaced with `src/util/regex.ts` `group()`,
  which throws `REGEX_GROUP_MISSING` and is tested directly, and with
  `siPrefix()` in place of a dead prefix-table fallback. 1034 tests.

**Next**

- Confirm CI, then M6 (PDF toolkit).

### 2026-09-10 — Session 6: Module 4 complete

**Done**

- `src/db/`: `Db` wrapper over `better-sqlite3` 13.0.3 (WAL, foreign keys,
  busy timeout), transactional migration runner with the full schema as
  migration 0001, and repositories for parts (validated aggregate upsert,
  filtered search on classifications and numeric parameter bounds), offers
  (per-distributor replace, best price at quantity), datasheets,
  verifications, escalations, and the Nexar budget (immediate-transaction
  reservation).
- 73 new tests: migration rollback and ordering, aggregate round trips,
  child-row replacement, rollback when a later insert fails, cascade and
  foreign-key enforcement, every filter clause, budget exhaustion and a
  two-connection race on a file database. Total 736 tests, 100% coverage,
  zero warnings.

**Learned**

- The `Part` invariant that `verified` status needs every parameter verified
  caught my own test fixture. Good.
- Read-side ordering must match write-side order for aggregates to round
  trip unchanged; covered MPNs are returned in insertion order, not sorted.
- `strictTypeChecked` and `stylisticTypeChecked` disagree on `as T` versus
  `!` for removing `undefined`; a small `requireRow` helper with its own test
  satisfies both and gives a real error code.
- Migrations live in TypeScript modules holding SQL strings rather than
  `.sql` files, so the build needs no asset copying (noted in the README).

- CI run 34445240661 green. M4 complete.

**Next**

- M5 (units and normalisation).

### 2026-09-10 — Session 5: Module 3 complete

**Done**

- `src/cache/`: canonical-JSON key hashing (`hashCacheKey`, `refOf`), the
  `CacheStore` interface and `CacheMeta` sidecar schema, `FileCacheStore`
  with sharded directories, atomic temp-file-and-rename writes, and
  self-healing on corrupt or mismatched entries, three codecs, and the
  `Cache` class whose `cached` method does TTL, force, in-flight
  de-duplication, and statistics.
- 66 new tests: key-order independence, namespace separation, a pinned
  digest, binary round trip, every corruption and I/O failure path,
  concurrent joins, forced calls during a flight, and fetch failure
  recovery. Total 663 tests, 100% coverage, zero warnings.

**Learned**

- `fs.rm` with `force: true` ignores only ENOENT. When the path runs through
  a regular file it throws ENOTDIR, so best-effort cleanup must swallow
  everything or it masks the original error.
- The pre-push hook checks the working tree, not the commit. Writing files
  in parallel with a push makes the push fail on half-written tests; push
  only when the tree is quiet.

- CI run 34444329069 green. M3 complete.

**Next**

- M4 (SQLite persistence).

### 2026-09-10 — Session 4: Module 2 complete

**Done**

- `src/log/`: structured JSON logger (stderr only, level filtering, child
  loggers), redaction (secret values, secret-shaped patterns, secret-looking
  keys, JSON-safe conversion of errors, dates, bigints, cycles), the
  append-only `ToolCallLedger` (validated records, per-day files, queued
  writes, blob sidecars for large outputs), the streaming `readLedger` with
  filters and mandatory malformed-line reporting, and `withLedger`.
- 58 new tests including concurrency (50 parallel ends, no interleaving),
  midnight rollover, write failure recovery, and secret redaction through
  the ledger path. Total 597 tests, 100% coverage, zero warnings.

**Learned**

- `Date` has whole-millisecond resolution, so a fractional clock step in a
  test is silently truncated; test rounding contracts with integer steps.
- Validate the record before serialising the output for the sidecar,
  otherwise a bigint in a tool output crashes `JSON.stringify` instead of
  surfacing as a `ValidationError`.

- CI run 34443836616 green, no warnings. M2 complete.

**Next**

- M3 (content-addressed cache).

### 2026-09-10 — Session 3: Module 1 complete; zero-warnings rule

**Done**

- Implemented every core schema under `src/core/`: primitives, quantities
  and unit-pinned factories, the four provenance kinds, the parameter
  wrapper, the thirty-field `BuckRegulatorParameters` with its cross-field
  invariants, `Offer`, `Datasheet`, `Classification` (typed per axis),
  `Escalation`, `Verification`, `ToolCallRecord`, the `Part` aggregate with
  its provenance and status invariants, and `ValidationError` /
  `parseOrThrow`.
- Test fixtures in `test/helpers/core-fixtures.ts` and the
  `expectAccepts` / `expectRejects` helpers. 539 tests, 100% coverage on
  every file, including the `CLAUDE.md` cases: a range written as text where
  a quantity is expected, a datasheet citation without a page, unknown keys.
- `src/core/README.md` documents the API and invariants. Decision D19
  records the schema conventions.

**Learned**

- Zod 4 keeps `.shape` and `.options` available after `.superRefine`, so the
  key-list and axis-list sync tests work directly against the schemas.
- With `noUncheckedIndexedAccess`, guarding indexed array reads creates
  branches that can never be false; iterate with `forEach` and a carried
  `previous` instead so every branch stays reachable.
- `no-unused-vars` needed `ignoreRestSiblings` for the
  `const { key: _key, ...rest }` idiom used to build "missing field" cases.

- CI run 34443141793 green. M1 complete.
- User rule adopted: no warnings anywhere (D20). Audit of every step found
  two: a Vitest transform-cache hint (fixed by setting `fsModuleCache: true`
  explicitly, which also speeds up reruns) and a git default-branch hint
  inside the CI checkout step (fixed by setting `init.defaultBranch` before
  checkout). `npm run lint` now fails on any warning. Definition of Done
  gained a no-warnings item.

**Next**

- Start M2 (structured logging and tool-call ledger).

### 2026-09-10 — Session 2: Module 0 complete

**Done**

- Installed `poppler-utils` 24.02.0 on the development machine.
- Scaffolded the project: `package.json` with exact-pinned dependencies and
  the `check` script, strict `tsconfig.json` plus `tsconfig.build.json`, ESLint
  flat config with type-checked rules, Prettier, Vitest with 100% per-file
  coverage thresholds, a separate opt-in live-test config, `.editorconfig`,
  `.env.example`, the directory layout with a README in every module
  directory, root `README.md`, GitHub Actions CI, and a `pre-push` hook that
  runs `npm run check`.
- Implemented and tested `src/errors.ts` (`ChipAgentError`), `src/config.ts`
  (`loadConfig`, `ConfigError`, `ENV_VARIABLE_NAMES`), `src/util/deep-freeze.ts`,
  and `src/gate/scan.ts` with the `scripts/gate.ts` shim. A test keeps
  `.env.example` in lockstep with the config schema, and another runs the gate
  over the real repository.
- `npm run check` is green locally: 126 tests, 100% statements, branches,
  functions, and lines on every file, gate clean.

**Learned**

- `typescript-eslint` does not yet accept TypeScript 7, so TypeScript is
  pinned to 6.0.3 (D17). Zod 4 transforms and `exactOptionalPropertyTypes`
  compile cleanly under it.
- The gate scanner catches its own test file if constants or rule names spell
  a forbidden token. Tokens are assembled from fragments and rule names avoid
  the literal strings (see `src/gate/README.md`).
- Vitest 5's text reporter prints an empty per-file table when every file is
  at 100%; `coverage/coverage-summary.json` still lists each file, which is
  what the per-file threshold checks.

- First CI run (GitHub Actions run 34442298021) green in 45 seconds: poppler
  install, `npm ci`, `npm run check`. Task 0.14 closed; M0 complete.

**Next**

- Start M1 (domain model and validation).

### 2026-09-10 — Session 1: repository and planning documents

**Done**

- Created the private GitHub repository `GavinMGlynn/cpu_datasheet_agent`,
  initialised git on `main`, added a Node/TypeScript `.gitignore` that also
  excludes `data/`, `cache/`, SQLite files, PDFs, and `.env`.
- Wrote `docs/PROJECT_PLAN.md`, `docs/COMPLETION_PLAN.md`, and
  `docs/REFERENCES.md`. Pointed `CLAUDE.md` at them.
- Verified external documentation for Digi-Key Product Information v4, the
  Claude Agent SDK (TypeScript reference, hooks, MCP), and the MCP TypeScript
  SDK. Recorded what could not be verified (Mouser pages timed out, Octopart
  reference returned 403) in `REFERENCES.md`.
- Recorded decisions D01 to D16.

**Learned**

- The MCP TypeScript SDK has moved to a v2 line split into
  `@modelcontextprotocol/server` and `@modelcontextprotocol/client`. The old
  `@modelcontextprotocol/sdk` package is the 1.x line.
- The Agent SDK exposes `PreToolUse` hooks that return
  `hookSpecificOutput.permissionDecision: "deny"` with a reason, and
  in-process MCP servers through `createSdkMcpServer` and `tool()`. Both are
  exactly what the money gate and the tool surface need.
- `CLAUDE.md` says `chip-mcp-server.ts` exists, but it is not in the
  repository. If it exists elsewhere it should be added so M12 can reconcile
  against it (open question Q3).

**Next**

- Start M0 (Foundation and tooling), beginning with installing
  `poppler-utils` and scaffolding `package.json`.

## 8. Open questions for the user

Answers get recorded as decisions in section 3 and the question is marked
resolved here.

| ID | Question | Blocks | Status |
| -- | -------- | ------ | ------ |
| Q1 | Are Digi-Key, Mouser, and Nexar API credentials already obtained? They are needed to record fixtures in M7, M8, M9, not before. | M7 | open |
| Q2 | Confirm buck regulators as the first (and for now only) component category. | M1 | open (assumed yes) |
| Q3 | `CLAUDE.md` references an existing `chip-mcp-server.ts`. It is not in the repo. Is there a copy to add? | M12 | open |
| Q4 | Digi-Key locale defaults AU / en / AUD acceptable? (D14) | M7 | open (assumed yes) |
| Q5 | Default model `claude-opus-5` at effort `high` for extraction and verification (D11). Acceptable cost-wise? One real extraction of TPS54331DR cost **$3.41** over 18 turns and 17 tool calls; most of that is datasheet page text re-sent each turn. A cheaper model is one flag away (`--model`), and M16 can measure what it costs in accuracy. | M14, M16 | open (assumed yes) |
| Q6 | The twenty-two golden parts were read by the model, not by a person (D47). Will you review them — or a sample — so the set becomes an independent reference rather than a baseline? `eval/golden/README.md` says what each file holds. | M16 | open |
| Q7 | Where an electrical table gives MIN / TYP / MAX for one parameter, which column is the value? The baseline puts a number on it: `maxDutyCycle` scored 5 of 14 and `switchingFrequency` 14 of 22, almost all of them the same disagreement. The golden reading took TYP for switching frequency (570 kHz) and the guaranteed MIN for maximum duty cycle (90%); the first real run took the whole range for the frequency (456–684 kHz, typ 570) and TYP for the duty cycle (93%). Neither misread the page. The convention wants deciding once, for the golden set and the prompt together. | M16 | open |

## 9. Known limitations

What the system does not do, found by running it rather than by thinking
about it. Each row names the evidence.

| # | Limitation | Evidence |
| - | ---------- | -------- |
| L1 | A derived value cannot be verified against a page. `feedbackAccuracy` is arithmetic on the stated reference limits — 0.792 V and 0.808 V about 0.8 V is ±1% — so the verification pass reads the cited page, finds no percentage, and returns `not_found`. Three parts in the sign-off sweep failed this way and none of them is wrong. The parameter's provenance should arguably be `derived` (the schema has the kind) rather than `datasheet`. | `AP63205WU-7`, `LMR33630ADDAR`, `MCP16331T-E/CH`, verification sweep 2026-09-12 |
| L2 | Reconciliation compares an operating-temperature maximum without comparing its reference. The datasheet states 125 °C junction and Digi-Key lists 85 °C ambient; they are both right and the comparison calls it a conflict. | Escalations on `AP62200WU-7` and `AP62201WU-7`, baseline 2026-09-11 |
| L3 | "What the page states" and "what applies to this orderable" are not the same claim, and the verification pass checks the first. The LM2596 datasheet states a 1.23 V feedback voltage for its adjustable version; the 3.3 V version stored `null` with a note, and the pass called it contradicted. The AP63357 case is the same shape the other way round: page 1 claims "up to 86% efficiency at 5 mA light load", the extraction stored no peak efficiency, and the pass called that contradicted too. Both are open escalations. | `LM2596S-3.3/NOPB` `feedbackReference` and `AP63357DV-7` `efficiencyPeak`, verification sweep 2026-09-12 |
| L4 | A datasheet can contradict itself, and nothing here decides which half wins. The LM5164-Q1 gives the low-side on-resistance as 0.34 Ω in a features bullet and 0.33 Ω in the electrical characteristics table; the run escalated rather than choosing, which is right, and the escalation is still open. | `LM5164QDDARQ1`, baseline 2026-09-11 |
| L5 | An AEC-Q100 claim on page 1 and an ordering table that does not repeat it are not reconciled. The MCP16331 datasheet claims automotive qualification device-wide; the extraction read the ordering table and stored `false`, which the golden reading says is wrong. | `MCP16331T-E/CH`, baseline 2026-09-11; golden note on `aecQ100` |
| L6 | The evaluation measures extraction against a reading by the same model family (D47). It catches regressions, gross errors and anything the pipeline fails to find; it cannot catch a misreading that comes from how the model reads. A human pass over the golden set is what would change that (Q6). | `eval/golden/README.md` |
| L7 | One datasheet page of text costs about a dollar to hold in context across a run, and the parameter set is written out twice — once for reconciliation, once to store. An extraction costs about $4 and a verification about $1. Both are prompt and tool-surface problems, not model problems. | Baseline 2026-09-11, $87.24 for 22 parts |
