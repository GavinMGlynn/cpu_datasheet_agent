# Completion Plan

Every task that must be finished for this project to be 100% complete. Tasks
are grouped into modules. Modules are done strictly in order: a module is
either **not started**, **in progress**, or **complete**, and only one module
is in progress at a time. Current status lives in `docs/PROJECT_PLAN.md`
section 4.

References in square brackets, for example `[R-03]`, point at rows in
`docs/REFERENCES.md`.

## Rules

1. **No MVP.** A module is not complete until every task in it is checked and
   every Definition of Done item is satisfied. "Good enough for now" does not
   exist here.
2. **No forward references in code.** A module may depend only on modules
   before it. If a later need is discovered, the earlier module is reopened,
   finished, and re-verified before continuing.
3. **No stubs.** Nothing committed throws "not implemented". A function that
   cannot be finished is a sign the module boundary is wrong; fix the plan
   first, then the code.
4. **Tests are part of the implementation,** not a follow-up. A task is
   checked only when its tests exist and pass at 100% coverage.
5. **Escalate, don't guess.** Where a task needs information only the user
   has (credentials, a decision, a real datasheet reading), record it in
   `PROJECT_PLAN.md` section 8 and continue with tasks that do not depend on
   it. Do not invent the answer.

## Definition of Done (applies to every module)

- [ ] Every task in the module is checked.
- [ ] `npm run check` is green locally: format check, lint, typecheck, and
      `test:coverage` with 100% lines, statements, branches, and functions on
      every file the module touches.
- [ ] CI is green on `main` for the commit that closes the module.
- [ ] No warnings from any step of `npm run check` or from CI. Lint runs with
      `--max-warnings 0`. A warning printed by any tool (npm, TypeScript,
      ESLint, Vitest, Node, git, GitHub Actions) is a defect to fix or
      silence at the source with a recorded reason, never to ignore.
- [ ] The static gate passes: no `TODO`, `FIXME`, `.skip`, `.only`,
      `@ts-ignore`, `@ts-expect-error` without a test proving the error, `any`,
      or `eslint-disable` in `src/` or `test/`.
- [ ] Every new dependency has a row in `docs/REFERENCES.md`.
- [ ] `src/<module>/README.md` documents the public API, the errors it
      throws, and the invariants it enforces.
- [ ] `docs/PROJECT_PLAN.md` status table updated and a log entry added.
- [ ] Committed and pushed.

---

## M0 — Foundation and tooling

Goal: a repository where `npm run check` enforces every rule in this document
before a single line of domain code exists.

- [x] 0.1 Install `poppler-utils` in the WSL distribution and record
      `pdftotext -v`, `pdftoppm -v`, `pdfinfo -v` in `PROJECT_PLAN.md`
      section 6. [R-20]
- [x] 0.2 `package.json`: name, `"type": "module"`, `"engines": {"node": ">=22"}`,
      `"private": true`, exact-pinned dependencies, scripts `build`,
      `typecheck`, `lint`, `format`, `format:check`, `test`, `test:coverage`,
      `test:live`, `check` (format:check, lint, typecheck, test:coverage, gate),
      `gate` (static grep gate from 0.9).
- [x] 0.3 `tsconfig.json`: `strict`, `module`/`moduleResolution` `NodeNext`,
      `target` ES2022, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
      `noImplicitOverride`, `noFallthroughCasesInSwitch`, `isolatedModules`,
      `verbatimModuleSyntax`. Separate `tsconfig.build.json` that excludes
      tests. Confirm the pinned TypeScript version works with
      `typescript-eslint`; if TypeScript 7 is not yet supported by the linter,
      pin the latest 5.x and record it as a decision. [R-21] [R-24]
- [x] 0.4 ESLint flat config with `typescript-eslint` `strictTypeChecked` and
      `stylisticTypeChecked`, plus Prettier. Rule additions: `no-console`
      (error, allowed only in `bin/`), `@typescript-eslint/no-explicit-any`
      (error), `@typescript-eslint/switch-exhaustiveness-check` (error).
      [R-24] [R-25]
- [x] 0.5 Vitest config: coverage provider V8, `include: ["src/**"]`,
      thresholds 100/100/100/100 with `perFile: true`, `reporter: ["text",
      "lcov", "json-summary"]`. `test:live` selects `test/live/**` and is
      skipped unless `LIVE_TESTS=1`. [R-22] [R-23]
- [x] 0.6 Create the directory layout from `PROJECT_PLAN.md` section 5 with a
      `README.md` in each `src/` module directory stating its purpose (one
      paragraph; expanded when the module is built).
- [x] 0.7 `.env.example` listing every variable the project will ever read:
      `DIGIKEY_CLIENT_ID`, `DIGIKEY_CLIENT_SECRET`, `DIGIKEY_SANDBOX`,
      `DIGIKEY_LOCALE_SITE`, `DIGIKEY_LOCALE_LANGUAGE`,
      `DIGIKEY_LOCALE_CURRENCY`, `MOUSER_API_KEY`, `NEXAR_CLIENT_ID`,
      `NEXAR_CLIENT_SECRET`, `NEXAR_ENABLED`, `NEXAR_BUDGET_LIMIT`,
      `ANTHROPIC_API_KEY`, `AGENT_MODEL`, `AGENT_EFFORT`, `DATA_DIR`,
      `LOG_LEVEL`, `LIVE_TESTS`. Each with a comment.
- [x] 0.8 `src/config.ts`: Zod schema for the environment; `loadConfig(env)`
      returns a frozen typed config or throws `ConfigError` listing every
      missing or malformed variable at once. Adapter credentials are optional
      at load time and required at adapter construction time (so M0 to M6 run
      without any keys). Tests: every variable's valid and invalid forms,
      aggregate error message, defaults.
- [x] 0.9 Static gate: logic in `src/gate/scan.ts` (covered by tests), entry
      shim `scripts/gate.ts`. Scans `src/`, `test/`, `scripts/`, `bin/` for the forbidden
      tokens listed in the Definition of Done and exits non-zero with file and
      line. Tests for the scanner itself.
- [x] 0.10 `src/errors.ts`: `ChipAgentError` base with `code`, `cause`,
      `details`; helper `isChipAgentError`. Tests.
- [x] 0.11 GitHub Actions workflow `.github/workflows/ci.yml`: Node 22,
      `npm ci`, `apt-get install poppler-utils`, `npm run check`. Runs on push
      and pull request. No secrets. [R-26]
- [x] 0.12 Git hooks via `simple-git-hooks`: `pre-push` runs `npm run check`.
      Document the bypass (`--no-verify`) as forbidden except for docs-only
      commits.
- [x] 0.13 `README.md` at repo root: setup, environment, commands, and a link
      to `docs/`.
- [x] 0.14 First CI run green with a trivial `src/config.ts` test suite at
      100% coverage.

---

## M1 — Domain model and validation

Goal: the complete, strict schema for a buck regulator part and everything
attached to it. This is the contract every later module writes against.

- [x] 1.1 Primitive schemas in `src/core/primitives.ts`: `Mpn` (raw and
      normalised forms), `ManufacturerName`, `Sha256`, `Iso8601`, `Url`,
      `PageNumber` (positive integer), `Currency` (ISO 4217 subset),
      `Percent`, `Celsius`.
- [x] 1.2 `Quantity` schema: `{ value: number, unit: Unit }` with `Unit` an
      enum of canonical SI units used by buck regulators (`V`, `A`, `Hz`, `s`,
      `Ohm`, `W`, `degC`, `percent`, `count`). Value must be finite. Ranges
      are a separate `QuantityRange` `{ min, max, typ? }` with `min <= max`
      and `typ` inside the range. A string is never accepted where a
      `Quantity` is expected (this is the "3 V to 32 V" rejection test).
- [x] 1.3 `Provenance` discriminated union:
      `datasheet { sha256, page, quote? , method: "text" | "image" }`,
      `distributor { distributor, sku, fetchedAt, cacheKey }`,
      `human { note, recordedAt }`,
      `derived { from: ParameterKey[], rule }`.
      A `datasheet` provenance without a `page` is a schema error, not a
      warning.
- [x] 1.4 `Parameter<T>` wrapper: `{ value: T, provenance: Provenance,
      confidence: "extracted" | "verified" | "conflict" }`.
- [x] 1.5 `BuckRegulatorParameters` schema, every field a `Parameter`:
      `vinMin`, `vinMax`, `vinAbsMax`, `voutMin`, `voutMax`, `voutFixed`
      (nullable), `ioutMax`, `switchingFrequency` (`QuantityRange` or fixed),
      `feedbackReference`, `feedbackAccuracy`, `quiescentCurrent`,
      `shutdownCurrent`, `topology` (`synchronous` | `non_synchronous`),
      `integration` (`integrated_fet` | `controller`), `softStart`
      (boolean plus optional time), `enablePin`, `powerGoodPin`,
      `lightLoadMode` (`pfm` | `psm` | `forced_pwm` | `none` | `selectable`),
      `externalSync`, `operatingTempMin`, `operatingTempMax`,
      `temperatureReference` (`junction` | `ambient`), `package`, `thermalPad`,
      `minOnTime`, `maxDutyCycle`, `efficiencyPeak`, `rdsOnHigh`, `rdsOnLow`,
      `aecQ100`. Cross-field refinements: `vinMin < vinMax <= vinAbsMax`,
      `voutMin <= voutMax`, `operatingTempMin < operatingTempMax`.
- [x] 1.6 `Offer` schema: distributor, distributor SKU, manufacturer, MPN as
      listed, currency, `priceBreaks: [{ quantity, unitPrice }]` sorted and
      strictly increasing in quantity, `stock`, `moq`, `packaging`
      (`cut_tape` | `reel` | `tube` | `tray` | `bulk` | `unknown`),
      `fetchedAt`, `provenance` (distributor).
- [x] 1.7 `Datasheet` schema: `url`, `sha256`, `pageCount`, `fetchedAt`,
      `localPath`, `coversMpns: Mpn[]` (from the ordering table; may be
      empty until M10 fills it).
- [x] 1.8 `Classification` schema: `axis`, `value`, `derivedFrom:
      ParameterKey[]`, `rule` (rule identifier, see M11).
- [x] 1.9 `Escalation` schema: `id`, `mpn`, `kind` (`ambiguous_mpn` |
      `conflict` | `unreadable_safety_rating` | `other`), `question`,
      `context`, `options?`, `createdAt`, `resolution?` (`{ answer,
      resolvedAt, by }`).
- [x] 1.10 `Verification` schema: `parameterKey`, `verdict` (`confirmed` |
      `contradicted` | `not_found`), `quote?`, `page`, `checkedAt`,
      `promptVersion`, `model`.
- [x] 1.11 `Part` aggregate schema: `mpn`, `manufacturer`, `category`
      (`buck_regulator` only for now), `parameters`, `datasheet?`, `offers`,
      `classifications`, `verifications`, `status` (`extracted` |
      `needs_human` | `verified` | `rejected`), `createdAt`, `updatedAt`.
      Strict: unknown keys rejected everywhere.
- [x] 1.12 `ToolCallRecord` schema for the ledger (M2): `id`, `sessionId`,
      `parentId?`, `tool`, `input`, `output?`, `error?`, `startedAt`,
      `durationMs`, `spendsQuota`.
- [x] 1.13 `ValidationError` (extends `ChipAgentError`) that carries the Zod
      issue list flattened to `path`, `message`, `received`.
- [x] 1.14 Tests: for every schema, a table of accepted and rejected inputs,
      including the specific `CLAUDE.md` cases (string where range expected,
      missing page number, extra keys, conflicting min/max). Type-level tests
      with `expectTypeOf` that inferred types match the intended shapes.

---

## M2 — Structured logging and tool-call ledger

Goal: every tool call is recorded, inputs and outputs, in an append-only file
that later becomes the eval dataset.

- [x] 2.1 `Logger` interface (`debug`, `info`, `warn`, `error`) emitting one
      JSON object per line to stderr, never stdout. Level from config. Child
      loggers with bound fields.
- [x] 2.2 Secret redaction: any value matching configured secret patterns
      (API keys, bearer tokens, `client_secret`) is replaced with
      `"[redacted]"` before serialisation. Tests prove secrets never reach the
      output for nested objects, arrays, and strings containing a secret.
- [x] 2.3 `ToolCallLedger`: `begin(tool, input, meta)` returns a record id;
      `end(id, output | error)` writes one `ToolCallRecord` line to
      `DATA_DIR/ledger/YYYY-MM-DD.jsonl`. Writes are serialised through a
      queue so concurrent calls never interleave partial lines. Output larger
      than a configurable size is written to a sidecar file and referenced by
      path and sha256.
- [x] 2.4 `LedgerReader`: async iterator over records across day files,
      with filters by `sessionId`, `tool`, and time range. Malformed lines are
      reported with line number and skipped, never silently dropped.
- [x] 2.5 `withLedger(tool, handler)` wrapper used by M12 so no handler can be
      registered without being logged.
- [x] 2.6 Tests: temp directory per test, concurrent writes, day rollover,
      sidecar threshold, reader filters, malformed line reporting, redaction
      through the ledger path.

---

## M3 — Content-addressed cache

Goal: every network call is cacheable by a hash of its request so reruns cost
nothing. One function, one store interface, ready to be swapped for S3 later.

- [x] 3.1 `CacheKey`: `{ namespace: string, params: JsonValue }` hashed as
      sha256 of a canonical JSON serialisation (sorted keys, no whitespace,
      normalised numbers). Tests prove key order independence and that
      different namespaces never collide.
- [x] 3.2 `CacheStore` interface: `get(hash)`, `put(hash, bytes, meta)`,
      `has(hash)`, `delete(hash)`, `stat(hash)`. `CacheMeta`: `createdAt`,
      `ttlSeconds?`, `contentType`, `sourceUrl?`, `size`, `sha256`.
- [x] 3.3 `FileCacheStore`: two-level sharded directories under
      `DATA_DIR/cache/<namespace>/ab/cd/<hash>` with a JSON sidecar for
      metadata. Atomic writes (temp file then rename). A missing or corrupt
      sidecar is a miss and is cleaned up.
- [x] 3.4 `cached(key, fetch, options)`: returns the cached value when present
      and unexpired, otherwise calls `fetch`, stores the result, returns it.
      Options: `ttlSeconds`, `force` (bypass and overwrite), `codec`
      (`json` | `bytes` | `text`). In-flight de-duplication: concurrent calls
      for the same key share one `fetch`.
- [x] 3.5 `CacheStats` counter (hits, misses, forced) exposed for the ledger
      and the eval harness.
- [x] 3.6 Tests: hit, miss, TTL expiry, force, each codec round-trip
      including binary PDFs, sharding paths, atomicity under a simulated crash
      (temp file left behind), in-flight de-duplication, corrupt sidecar
      recovery.

---

## M4 — Persistence (SQLite)

Goal: parts, parameters, offers, datasheets, classifications, verifications,
escalations, and the Nexar budget stored durably behind a repository
interface. `upsert_part` validates and rejects; it never coerces.

- [ ] 4.1 `Database` wrapper over `better-sqlite3`: opens with WAL, foreign
      keys on, busy timeout; `:memory:` supported for tests. [R-27]
- [ ] 4.2 Migrations: numbered SQL files under `src/db/migrations/`, applied
      in a transaction, tracked in `schema_migrations`. Re-running is a
      no-op. A migration that fails rolls back completely.
- [ ] 4.3 Schema: `parts`, `parameters` (one row per parameter with value
      JSON, unit, provenance columns, confidence), `datasheets`,
      `datasheet_mpns`, `offers`, `price_breaks`, `classifications`,
      `verifications`, `escalations`, `nexar_budget`, `runs` (for M14).
      Indices on `parts.mpn`, `parameters(part_id, key)`, `offers(part_id,
      distributor)`.
- [ ] 4.4 `PartRepository`: `upsertPart(part)` parses with the M1 `Part`
      schema first and throws `ValidationError` on any issue, then writes
      part and parameters in one transaction; `getPart(mpn)`,
      `findParts(filter)` (by category, classification axis/value, numeric
      parameter ranges), `listByStatus(status)`.
- [ ] 4.5 `OfferRepository`: `replaceOffers(partId, distributor, offers)`
      (replaces that distributor's rows atomically), `getOffers(partId)`,
      `bestPriceAt(partId, quantity)`.
- [ ] 4.6 `DatasheetRepository`: `record(datasheet)`, `getBySha(sha)`,
      `linkMpn(sha, mpn)`, `mpnsCoveredBy(sha)`.
- [ ] 4.7 `VerificationRepository` and `EscalationRepository`: create,
      list open, resolve. Resolving an escalation records who and when.
- [ ] 4.8 `NexarBudgetRepository`: `used()`, `limit()`, `reserve(n)` in a
      transaction that fails with `BudgetExhaustedError` if `used + n >
      limit`.
- [ ] 4.9 Tests on an in-memory database: migration idempotence and rollback,
      every repository method, every rejection path of `upsertPart`
      (including the `CLAUDE.md` string-instead-of-range case), transaction
      atomicity when a later insert fails, foreign-key enforcement, budget
      reservation races using two connections.

---

## M5 — Units, parsing, and normalisation

Goal: turn the strings found in datasheets and distributor parametrics into
canonical `Quantity` values, deterministically, and compare them with
tolerances.

- [ ] 5.1 Tokeniser for engineering notation: SI prefixes (`p` to `G`),
      unit aliases (`V`, `Volt`, `A`, `mA`, `Hz`, `kHz`, `MHz`, `Ω`, `Ohm`,
      `ohm`, `°C`, `degC`, `C`, `%`), unicode variants (`µ`, `μ`, `u`, `Ω`,
      `Ω`), unicode minus and dashes, thin and non-breaking spaces, "3V3"
      style, `±`, `to`, `–`, `...`, and `/` as range separators.
- [ ] 5.2 `parseQuantity(text, expectedUnit)` returns `Quantity` or a typed
      `ParseError` with the reason. Never returns `NaN`. Rejects values whose
      unit family does not match `expectedUnit`.
- [ ] 5.3 `parseRange(text, expectedUnit)` returns `QuantityRange` or
      `ParseError`; single values are not silently promoted to ranges.
- [ ] 5.4 `parseTemperatureRange` for `-40°C to +125°C` and variants,
      including `TA` / `TJ` suffix detection returning the reference.
- [ ] 5.5 `formatQuantity` producing a canonical string, with a property test
      (`fast-check`) that `parse(format(q))` equals `q`. [R-28]
- [ ] 5.6 `compareQuantities(a, b, tolerance)` with relative and absolute
      tolerance, unit conversion first, returning `equal` | `a_greater` |
      `b_greater` and the normalised difference.
- [ ] 5.7 Distributor parametric mappers: `digikeyParameterToKey(name)` and
      `mouserAttributeToKey(name)` covering every buck-regulator attribute
      name seen in the M7/M8 fixtures, returning `null` for unmapped names.
      Every mapping row has a test.
- [ ] 5.8 Tests: table-driven cases for every alias and separator, property
      tests for round trips and for "parse never throws anything but
      `ParseError`", exhaustive mapper coverage.

---

## M6 — PDF toolkit

Goal: fetch a datasheet, read pages as text, render pages as images, and
locate the sections the agent needs. All through poppler, all cached.

- [ ] 6.1 `Subprocess` wrapper: `run(bin, args, { timeoutMs, maxOutputBytes })`
      returning stdout, stderr, exit code; kills on timeout; typed
      `SubprocessError`. Tests with a real child process and with an injected
      spawner for failure paths.
- [ ] 6.2 `popplerPreflight()`: locates `pdftotext`, `pdftoppm`, `pdfinfo`,
      records versions, throws `PopplerMissingError` with install
      instructions if absent.
- [ ] 6.3 `fetchPdf(url)`: through `cached()` (namespace `pdf`), follows
      redirects up to a limit, enforces a size cap, checks `%PDF-` magic
      bytes, retries 5xx with backoff, sends a fixed User-Agent, returns
      `{ localPath, sha256, bytes }`. Content-type mismatches are errors.
- [ ] 6.4 `pdfInfo(path)`: page count, title, producer, and the
      encrypted flag via `pdfinfo`.
- [ ] 6.5 `readPages(path, pages)`: `pdftotext -layout -f N -l N` per page,
      cached per `(sha256, page)`, returns `{ page, text, metrics }` where
      `metrics` are deterministic numbers the agent can use to decide whether
      a table is mangled: line count, numeric tokens without an adjacent
      label, columns detected by whitespace runs.
- [ ] 6.6 `renderPage(path, page, dpi = 200)`: `pdftoppm -png -r 200 -f N -l
      N -singlefile`, cached, returns PNG path and bytes.
- [ ] 6.7 `findPages(path, patterns)`: full-text scan of all pages returning
      matches per page for section headings: "Ordering Information",
      "Electrical Characteristics", "Absolute Maximum Ratings", "Recommended
      Operating Conditions", "Pin Configuration", "Package".
- [ ] 6.8 Test fixture generator using `pdf-lib`: produces multi-page PDFs
      with known text, a mangled-looking table, and an ordering table.
      [R-29]
- [ ] 6.9 Tests: every function against generated PDFs with real poppler;
      cache hits verified by counting subprocess invocations; every error
      path (timeout, missing binary, bad magic bytes, size cap, encrypted
      PDF).

---

## M7 — Digi-Key adapter

Goal: search, product details, pricing, and datasheet URLs from Digi-Key
Product Information v4, cached and logged. [R-01] [R-02]

- [ ] 7.1 OAuth2 client-credentials token client: fetches from the Digi-Key
      token endpoint, caches the token with expiry in memory and in
      `DATA_DIR/tokens/`, refreshes ahead of expiry, retries once on 401.
      Sandbox and production hosts selectable by `DIGIKEY_SANDBOX`.
- [ ] 7.2 Request layer: headers `X-DIGIKEY-Client-Id`,
      `X-DIGIKEY-Locale-Site`, `X-DIGIKEY-Locale-Language`,
      `X-DIGIKEY-Locale-Currency`; token-bucket rate limiter; backoff on 429
      and 5xx; typed `DigiKeyError` with the API's error body.
- [ ] 7.3 Record the exact endpoint paths and request shapes for
      `KeywordSearch`, `ProductDetails`, `ProductPricing`,
      `PricingOptionsByQuantity`, `Media`, `Substitutions`, and
      `AlternatePackaging` from the developer portal into
      `src/adapters/digikey/README.md` with the date checked. [R-02]
- [ ] 7.4 Response schemas (Zod, strict on the fields we use, passthrough
      elsewhere) for each endpoint above.
- [ ] 7.5 Operations: `searchKeyword(mpn)`, `productDetails(productNumber)`,
      `pricing(productNumber)`, `media(productNumber)` (datasheet URL),
      `substitutions(productNumber)`. Each goes through `cached()` and the
      ledger, and maps to M1 `Offer[]`, distributor parametrics (via M5
      mappers), and datasheet URL.
- [ ] 7.6 `scripts/record-fixture.ts digikey <mpn>`: performs live calls,
      strips tokens and account details, writes sanitised JSON under
      `test/fixtures/digikey/`. Requires credentials (Q1).
- [ ] 7.7 Fixtures recorded for at least ten of the golden-set candidates
      (see M13) including one with multiple packaging variants and one with
      no Digi-Key listing.
- [ ] 7.8 Tests with `msw`: token lifecycle, every operation against
      fixtures, rate limiting, 429/5xx backoff, malformed responses rejected
      by schema, cache hit prevents network, ledger record per call.
      [R-30]
- [ ] 7.9 Live contract test in `test/live/digikey.test.ts` (opt-in) that
      re-validates fixtures against the real API and fails on schema drift.

---

## M8 — Mouser adapter

Goal: part-number search, pricing, availability, and datasheet URL from the
Mouser Search API. [R-03] [R-04]

- [ ] 8.1 Confirm the endpoint paths, base URL, API-key parameter, and rate
      limits from the Mouser API hub and record them with the date checked in
      `src/adapters/mouser/README.md`. (Pages timed out on 2026-09-10; must
      be re-checked.)
- [ ] 8.2 Request layer: API key handling, rate limiter, backoff, typed
      `MouserError`.
- [ ] 8.3 Response schemas for part-number search and keyword search.
- [ ] 8.4 Operations: `searchPartNumber(mpn)`, `searchKeyword(text)`, mapping
      to `Offer[]`, parametrics, datasheet URL. Cached and logged.
- [ ] 8.5 Fixture recorder and fixtures for the same ten candidates as 7.7.
- [ ] 8.6 Tests as in 7.8, plus the live contract test.

---

## M9 — Nexar adapter with hard budget

Goal: cross-distributor lookup and datasheet URL from Nexar, impossible to
call past the lifetime allowance. [R-05] [R-06]

- [ ] 9.1 Confirm the GraphQL endpoint, identity endpoint, and the supply
      query names and shapes from the Nexar support articles; record in
      `src/adapters/nexar/README.md` with the date checked.
- [ ] 9.2 OAuth2 client-credentials token client (same pattern as 7.1).
- [ ] 9.3 GraphQL client with typed query documents and strict response
      schemas for MPN search returning manufacturer, MPN, datasheet URL,
      category, and seller offers.
- [ ] 9.4 Budget guard: every operation calls
      `NexarBudgetRepository.reserve(n)` before any network call, where `n` is
      the number of MPNs requested. A cache hit reserves nothing. When
      `NEXAR_ENABLED` is not `1`, every operation throws `NexarDisabledError`
      before touching the budget.
- [ ] 9.5 Operations: `searchMpn(mpn)` and `searchMpns(mpns[])` (batched to
      minimise part count), mapped to `Offer[]` and datasheet URL.
- [ ] 9.6 Fixture recorder and fixtures for at most five candidates, chosen
      to include one not found on Digi-Key or Mouser. Actual spend recorded
      in `PROJECT_PLAN.md`.
- [ ] 9.7 Tests: disabled path, budget reservation and exhaustion, cache
      never spends, batched reservation counts, schema rejection, ledger.

---

## M10 — MPN resolution

Goal: from a raw part number, identify the base part, decode its suffix, find
the distributor listings that actually match, and escalate when ambiguous.

- [ ] 10.1 `normaliseMpn(raw)`: trim, uppercase, collapse whitespace, strip
      known distributor prefixes and "-ND" style suffixes, keep the original.
- [ ] 10.2 Manufacturer suffix decoders, one file per manufacturer covered by
      the golden set (at minimum Texas Instruments, Monolithic Power Systems,
      Diodes Incorporated, Analog Devices, Richtek, onsemi, Microchip,
      STMicroelectronics): return `{ basePart, package, temperatureGrade,
      packaging, leadFinish?, extras }` or `null` when the pattern is unknown.
      Never guess: unknown suffix means `null`, not a partial decode.
- [ ] 10.3 Candidate gathering: query Digi-Key and Mouser (M7, M8) for the
      normalised MPN, collect every listing, decode each listing's MPN.
- [ ] 10.4 Matching: exact MPN match wins; otherwise base-part match with a
      different packaging suffix only is a "packaging variant"; base-part
      match with a different package or temperature grade is a "sibling", not
      a match. More than one exact match with different manufacturers, or no
      exact match and more than one sibling, produces an `Escalation` of kind
      `ambiguous_mpn` with the candidates as options.
- [ ] 10.5 Family detection: when a datasheet's ordering table (M6
      `findPages` plus M5 parsing) lists several MPNs, link all of them to
      the datasheet sha (M4 `linkMpn`).
- [ ] 10.6 Tests: at least thirty real MPNs per manufacturer decoder group
      hand-verified against the manufacturer's ordering guide, every
      ambiguity rule, family linking against a generated ordering table.

---

## M11 — Reconciliation and classification

Goal: compare datasheet-extracted values with distributor parametrics, flag
conflicts, and derive categorisation axes deterministically.

- [ ] 11.1 `reconcile(extracted, distributorParametrics)`: for each parameter
      present in both, `compareQuantities` with per-parameter tolerance;
      outcomes `agree`, `conflict`, `datasheet_only`, `distributor_only`.
- [ ] 11.2 Safety-relevant parameter list (`vinAbsMax`, `vinMax`, `ioutMax`,
      `operatingTempMin`, `operatingTempMax`, `rdsOn*`): a conflict here
      always produces an `Escalation` of kind `conflict` and marks the
      parameter `confidence: "conflict"`. It is never auto-resolved.
- [ ] 11.3 Non-safety conflicts keep the datasheet value, record the
      distributor value in the parameter's provenance details, and mark
      `conflict`.
- [ ] 11.4 Classification rules, each a pure function with an identifier:
      `vinClass` (`le_5v5`, `le_18v`, `le_42v`, `le_60v`, `gt_60v`),
      `ioutClass` (`le_1a`, `le_3a`, `le_6a`, `le_12a`, `gt_12a`),
      `topology`, `integration`, `outputType` (`fixed` | `adjustable`),
      `packageFamily` (SOT-23, SOIC, QFN, TSSOP, DFN, other) from the
      package string, `temperatureGrade` (`commercial`, `industrial`,
      `extended`, `automotive`) from the range and `aecQ100`, `features`
      (set of `enable`, `power_good`, `soft_start`, `sync`, `light_load`).
      Every classification records `derivedFrom` and the rule id.
- [ ] 11.5 `classify(parameters)` returns all axes or a typed error listing
      the missing parameters; it never returns a partial silently.
- [ ] 11.6 Tests: every outcome of reconcile, every safety escalation, every
      rule at its boundaries, missing-parameter reporting.

---

## M12 — Tool registry and MCP server

Goal: the complete tool surface, logged and gated, exposed both as a stdio
MCP server and as an in-process server for the agent runner. [R-07] [R-08]

- [ ] 12.1 `ToolDefinition` type: `name`, `description`, Zod `input` and
      `output` schemas, `spendsQuota: boolean`, `annotations`
      (`readOnlyHint`, `destructiveHint`), `handler`. `ToolRegistry` that
      refuses duplicate names and wraps every handler with `withLedger` and
      output validation (a handler returning something that fails its own
      output schema is a bug and throws).
- [ ] 12.2 Tools (each with full input and output schemas):
      `resolve_mpn`, `fetch_offers`, `fetch_datasheet`, `pdf_info`,
      `find_pages`, `read_pages`, `render_page` (returns an image content
      block), `normalise_value`, `reconcile_parameters`, `classify_part`,
      `upsert_part`, `get_part`, `search_parts`, `record_verification`,
      `ask_human`, `list_escalations`, `nexar_budget_status`,
      `cache_stats`.
- [ ] 12.3 Quota policy: tools with `spendsQuota` accept `confirmSpend:
      true`; without it, and without a cache hit, they return a structured
      `needs_confirmation` result rather than spending. The policy is a
      separate object so M14 can configure it per run.
- [ ] 12.4 `ask_human` semantics: writes an `Escalation`, returns its id, and
      in headless mode marks the part `needs_human`. It never blocks the
      server.
- [ ] 12.5 Stdio MCP server adapter in `src/mcp/` using
      `@modelcontextprotocol/server`: registers every tool from the registry,
      maps `ChipAgentError` to MCP error results with the `code`, logs to
      stderr only. Entry point `bin/chip-mcp.ts`.
- [ ] 12.6 In-process adapter in `src/mcp/sdk.ts` that builds the same
      registry into `createSdkMcpServer` tools for M14. Tool names must be
      identical in both adapters (test).
- [ ] 12.7 Reconcile against `chip-mcp-server.ts` if the user supplies it
      (Q3): every tool and schema it defined is either present here or its
      omission is recorded as a decision.
- [ ] 12.8 Tests: in-process MCP client over an in-memory transport calling
      every tool's success and failure paths; schema rejection of bad input;
      output validation failure; `needs_confirmation` flow; one ledger record
      per call; stdout is empty during a full session; the two adapters expose
      identical tool lists.
- [ ] 12.9 Manual check recorded in the log: the server runs under the MCP
      Inspector and under Claude Code as a project MCP server. [R-09]

---

## M13 — Golden evaluation set

Goal: twenty buck regulators characterised by a human reading the datasheet,
every value with a page number, stored in the M1 schema. Nothing the agent
produces is trusted until it is measured against this set.

- [ ] 13.1 Select twenty parts from the candidate list below, spanning at
      least six manufacturers, every `vinClass`, every `ioutClass` up to
      `le_12a`, both topologies, both integration types, fixed and adjustable
      outputs, and at least two automotive-grade parts. Record the final list
      and the reason for each choice in `eval/golden/README.md`.
      Candidates (to be confirmed as still available with a public
      datasheet): TPS54331, TPS562200, TPS563200, TPS62130, TLV62569, LM2596,
      LMR33630, LM5164, LMR36015, TPS54560, MP1584, MP2315, MP2307, MPQ4420,
      AP63203, AP62200, RT8279, LT8610, LTC3630, MAX17503, NCP3170, MCP16331,
      ST1S10, AOZ1282, SY8113, XL4015.
- [ ] 13.2 For each part: download the datasheet with M6 `fetchPdf`, record
      URL and sha256, read it by eye (text and rendered pages), and fill every
      field of `BuckRegulatorParameters` with a `datasheet` provenance and
      page number, or an explicit `null` with a note when the datasheet does
      not state it. Record who read it and when.
- [ ] 13.3 For each part: the ordering-table MPN list it covers, and the
      expected decoded suffix for the golden MPN (feeds M10 tests).
- [ ] 13.4 For each part: recorded, sanitised Digi-Key and Mouser fixtures
      (extends 7.7 and 8.5 to all twenty).
- [ ] 13.5 Expected classifications for every axis, hand-derived.
- [ ] 13.6 A test that loads every golden file, validates it against the M1
      schemas, checks that every datasheet provenance has a page within the
      recorded page count, and that the sha256 matches the cached PDF.
- [ ] 13.7 `Scorer`: compares an extracted `Part` to a golden `Part` per
      parameter: exact for enums and booleans, `compareQuantities` with the
      per-parameter tolerance for numbers, page match for provenance
      (exact, plus a "within one page" bucket reported separately). Produces
      per-parameter and per-part precision, recall, and provenance accuracy.
      Tests for every scoring rule.

---

## M14 — Agent runner (extraction)

Goal: a headless run that takes an MPN through resolve, offers, datasheet,
extraction, reconciliation, classification, and persistence, with money gated
and every decision logged. [R-10] [R-11] [R-12]

- [ ] 14.1 `prompts/extract.v1.md`: system prompt encoding the
      non-negotiables (provenance with page numbers, reject-never-coerce,
      escalate on conflict or ambiguity, render the page when text metrics
      look mangled, one datasheet covers a family), the tool usage order, and
      the required final action (`upsert_part`). Snapshot test.
- [ ] 14.2 `RunConfig`: model, effort, `maxTurns`, budget policy (allowed
      quota spend, Nexar allowed or not), prompt version, `DATA_DIR`.
- [ ] 14.3 `PreToolUse` hook: matches `mcp__chip__*`; for tools flagged
      `spendsQuota` returns `permissionDecision: "deny"` with a reason unless
      the run's budget policy allows the spend, in which case it rewrites the
      input with `confirmSpend: true`; every decision is logged to the ledger
      with the tool-use id.
- [ ] 14.4 `extractPart(mpn, config)`: builds the in-process MCP server
      (M12), calls `query()` with `allowedTools: ["mcp__chip__*"]`, every
      built-in tool disallowed, `maxTurns` set, and a `RunRecorder` that
      persists the `runs` row (session id, prompt version, model, turns,
      `total_cost_usd`, result subtype, escalations raised).
- [ ] 14.5 Outcome mapping: `success` with an `upsert_part` in the ledger
      is `extracted`; `ask_human` raised is `needs_human`; anything else is
      `rejected` with the reason, and the ledger holds the transcript.
- [ ] 14.6 `bin/chip-run.ts extract <mpn> [--model] [--effort]
      [--allow-spend] [--allow-nexar]`: CLI over `extractPart`.
- [ ] 14.7 Batch mode: `extract-many <file>` processes MPNs sequentially,
      resumable (skips MPNs with a completed run for the same prompt version
      unless `--force`).
- [ ] 14.8 Tests: `query` injected as a dependency and replaced with a
      scripted fake that emits realistic SDK messages; hook decisions for
      every policy combination; run record persistence; outcome mapping;
      batch resume; CLI argument parsing. No test calls the real API.
- [ ] 14.9 One real extraction run on one golden part, cost recorded in the
      log, output compared with the golden file by the M13 scorer, result
      recorded in `PROJECT_PLAN.md`.

---

## M15 — Verification pass

Goal: a second run, in a fresh context that has never seen the extraction
transcript, checks every stored datasheet-sourced value against its cited
page.

- [ ] 15.1 `prompts/verify.v1.md`: for each parameter, given only the cited
      page text (and image when requested), answer `confirmed`,
      `contradicted`, or `not_found` with a quote. Snapshot test.
- [ ] 15.2 `verifyPart(mpn, config)`: loads the stored part, groups
      parameters by cited page, starts a new `query()` per part with no
      `resume` and no shared session, exposes only `read_pages`,
      `render_page`, and `record_verification`, and stores every verdict.
- [ ] 15.3 Status transitions: all `confirmed` sets the part `verified`; any
      `contradicted` raises an `Escalation` of kind `conflict` and sets
      `needs_human`; `not_found` on a safety-relevant parameter is treated as
      `contradicted`.
- [ ] 15.4 Isolation is enforced by construction: the verification runner
      takes a `PartId`, not a run or session, and a test asserts the fake
      `query` receives no `resume`, no prior messages, and a different
      session id from the extraction run.
- [ ] 15.5 CLI `chip-run verify <mpn>` and `verify-pending`.
- [ ] 15.6 Tests: verdict handling, every status transition, safety
      escalation, isolation assertion, CLI.
- [ ] 15.7 One real verification run on the part from 14.9, cost and outcome
      recorded.

---

## M16 — Evaluation harness

Goal: run extraction and verification over the golden set offline, score
against the golden files, and report regressions between prompt versions and
models.

- [ ] 16.1 `runEval(config)`: for every golden part, run extraction with all
      network served from cache (a cache miss is a test failure, not a
      spend), then score with the M13 scorer.
- [ ] 16.2 Report: JSON and Markdown under `eval/results/<timestamp>-<prompt
      version>-<model>/` with per-part and aggregate precision, recall,
      provenance accuracy, escalation counts, turns, cost, and duration.
- [ ] 16.3 Comparison: `eval compare <a> <b>` diffs two result directories
      and flags any parameter whose score dropped.
- [ ] 16.4 Replay: `eval replay <session id>` reconstructs a run's tool calls
      from the ledger for inspection.
- [ ] 16.5 Eval health checks per the eval checklist [R-33]: golden set has
      no duplicate parts, every parameter has at least three golden examples,
      the scorer is tested for false positives, and the report states the
      prompt version and model.
- [ ] 16.6 Tests: harness with a fake runner and fake cache, report
      rendering, comparison logic, replay.
- [ ] 16.7 Baseline: full eval over the twenty golden parts with
      `extract.v1` and `claude-opus-5`, results committed under
      `eval/results/`, summary in `PROJECT_PLAN.md`.

---

## M17 — Alternates query

Goal: answer "find a cheaper alternate that still meets these constraints"
from verified data, with the pin-compatibility caveat stated every time.

- [ ] 17.1 `AlternateQuery` schema: reference MPN, constraints (`vinRange`
      must be covered, `ioutMin`, `topology?`, `integration?`,
      `packageFamily?`, `temperatureGrade?`, `features?`), quantity for
      pricing, `includeUnverified` (default false).
- [ ] 17.2 `findAlternates(query)`: filters parts by constraints using M4
      queries, ranks by unit price at the requested quantity, returns
      candidates with a per-parameter comparison table against the reference
      and a mandatory `pinCompatibility: "not_assessed"` field plus the
      explicit disclaimer text.
- [ ] 17.3 MCP tool `find_alternates` in the registry and CLI
      `chip-run alternates <mpn> --vin 8-36 --iout 2 --qty 100`.
- [ ] 17.4 Tests: constraint filtering at boundaries, ranking, currency
      consistency, unverified exclusion, disclaimer always present, empty
      result.

---

## M18 — Release and end-to-end sign-off

Goal: the whole pipeline runs on real data, the documents describe what
exists, and the repository is tagged.

- [ ] 18.1 End-to-end run: `extract-many` then `verify-pending` over the
      twenty golden parts with live APIs (one approved spend event), followed
      by `runEval` against the resulting cache. Cost and results recorded.
- [ ] 18.2 Every open escalation from 18.1 resolved by the user or recorded
      as a known limitation in `PROJECT_PLAN.md`.
- [ ] 18.3 `README.md`, `CLAUDE.md` "Current state" and "Next steps", and
      every `src/*/README.md` reviewed for accuracy against the code.
- [ ] 18.4 `docs/REFERENCES.md`: every row re-checked, dates updated,
      unverified rows resolved or removed.
- [ ] 18.5 Tag `v1.0.0`, push the tag, log entry closing the plan.
