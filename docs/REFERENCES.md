# References

Every external document, API, library, and web page this project relies on.
Anything cited in `CLAUDE.md`, `PROJECT_PLAN.md`, `COMPLETION_PLAN.md`, a
module README, or a code comment must have a row here.

## Rules

1. Add a row before, or in the same commit as, the first citation.
2. Cite rows by ID, for example `[R-02]`.
3. **Status** records whether the URL was actually opened and checked:
   - `verified YYYY-MM-DD` means the page was fetched on that date and says
     what the row claims.
   - `unverified` means the URL is believed correct but was not reachable or
     not checked. It must be verified before the module that uses it is
     marked complete.
   - `from Anthropic reference` means the URL came from Anthropic's own
     documentation index and was not fetched separately.
4. Never remove a row that a document still cites. Mark it `superseded` and
   point at the replacement.
5. Do not add scraped distributor web pages. APIs only (see `CLAUDE.md`).

## Distributor and part-data APIs

| ID   | Title | URL | Used for | Status |
| ---- | ----- | --- | -------- | ------ |
| R-01 | Digi-Key Product Information v4 (overview) | https://developer.digikey.com/products/product-information-v4 | Primary distributor source: parametrics, pricing, datasheet URLs. Lists the `ProductSearch` and `ProductChangeNotifications` APIs. | verified 2026-09-10 |
| R-02 | Digi-Key Product Information v4, ProductSearch endpoints | https://developer.digikey.com/products/product-information-v4/productsearch | Endpoint index: `KeywordSearch` (POST), `ProductDetails`, `ProductPricing`, `PricingOptionsByQuantity`, `Media`, `Substitutions`, `AlternatePackaging`, `RecommendedProducts`, `Associations`, `Manufacturers`, `Categories`, `CategoriesById`, `DigiReelPricing` (GET), `PackageTypeByQuantity` (deprecated). Exact paths, base URLs, headers, and rate limits are on the per-endpoint pages and must be recorded in M7 task 7.3. | verified 2026-09-10; every path below exercised live against a production app, see `src/adapters/digikey/README.md` |
| R-60 | Digi-Key OAuth 2.0 2-legged flow | https://developer.digikey.com/tutorials-and-resources/oauth-20-2-legged-flow | Client-credentials token flow for Module 7 task 7.1. Token endpoints: production `https://api.digikey.com/v1/oauth2/token`, sandbox `https://sandbox-api.digikey.com/v1/oauth2/token`. POST `application/x-www-form-urlencoded` with `client_id`, `client_secret`, `grant_type=client_credentials`. Response carries `access_token`, `expires_in` (600 seconds), `token_type` `Bearer`. Calls send `Authorization: Bearer <token>` plus `X-DIGIKEY-Client-Id` and the locale headers. | verified 2026-09-10 |
| R-03 | Mouser API hub | https://www.mouser.com/api-hub/ | Mouser Search API: part-number and keyword search, pricing, availability, datasheet URL. API key obtained here. | unverified: the page timed out from this machine on 2026-09-10 and again on 2026-09-12. The API behind it is verified by use — a live key, recorded fixtures, and the contract tests in `test/live/` |
| R-04 | Mouser API documentation (Swagger UI) | https://api.mouser.com/api/docs/ui/index | Endpoint paths and request/response shapes for the Search API. | unverified: the page renders its content in a browser and returns nothing to a plain client, on 2026-09-10 and again on 2026-09-12. The two endpoints this project calls are recorded in `src/adapters/mouser/README.md` and exercised live |
| R-61 | element14 / Farnell / Newark Product Search API | https://partner.element14.com/Search_API | Free key, 2 calls per second and 1000 per day. REST, `GET https://api.element14.com/catalog/products` with `term=manuPartNum:<mpn>`, `storeInfo.id`, `resultsSettings.responseGroup=large`, `callInfo.apiKey`. Returns electrical attributes (32 for TPS54331DR) but **no datasheet field** and no AUD pricing for parts the Australian store does not list. Checked live 2026-09-10. | verified 2026-09-10 |
| R-05b | Nexar API commentary | https://zenode.ai/posts/the-nexar-api-what-engineers-need-to-know-in-2026 | Third-party article reporting the Standard tier at about US$500 per month for 2,000 parts. | unverified, and nothing depends on it: the tier limits this project acts on come from R-06, and Nexar is deferred (D29) |
| R-05 | Nexar API support and documentation | https://support.nexar.com/ | Nexar (Octopart) supply data: cross-distributor offers and datasheet URLs. `https://docs.nexar.com/` redirects here. Articles "Introduction to the Nexar API" and "Make Your First Octopart Supply Data Query" hold the endpoint and query details needed for M9 task 9.1. | verified 2026-09-10 (landing page only); M9 is deferred (D29), so the endpoint details were never needed |
| R-06 | Nexar plan comparison | https://nexar.com/compare-plans | Tiers and what each includes. Evaluation is free, up to 100 matched parts, and is the **only non-Enterprise tier that includes datasheets and tech specs**. Standard (2,000 matched parts) and Pro (15,000) include only search, pricing, availability, images and descriptions; they exclude datasheets, tech specs, lifecycle status and lead time. Prices are not published on the page. Source of the hard budget in D13. | verified 2026-09-10, re-checked 2026-09-12: the tiers and what each includes are unchanged |

## Model Context Protocol

| ID   | Title | URL | Used for | Status |
| ---- | ----- | --- | -------- | ------ |
| R-07 | MCP TypeScript SDK repository | https://github.com/modelcontextprotocol/typescript-sdk | v2 stable line, packages `@modelcontextprotocol/server` (2.0.0) and `@modelcontextprotocol/client` (2.0.0), `McpServer` class. Targets the 2026-07-28 MCP spec. The 1.x line is `@modelcontextprotocol/sdk`, which the Agent SDK still peer-depends on and bundles. | verified 2026-09-11; both packages installed and pinned in M12, `registerTool`, `serveStdio`, `InMemoryTransport` and the client's `listTools`/`callTool` all exercised in tests |
| R-08 | Model Context Protocol specification and docs | https://modelcontextprotocol.io/ | Protocol semantics: tools, resources, transports, error results. Current specification 2026-07-28, which is the one the v2 SDK targets (R-07). | verified 2026-09-12 |
| R-09 | MCP Inspector | https://github.com/modelcontextprotocol/inspector | Manual check of the stdio server in M12 task 12.9. Needs a browser, so the equivalent check was done by driving `bin/chip-mcp.ts` over real pipes instead (see the session 16 log). | verified 2026-09-12; the tool exists and runs with `npx @modelcontextprotocol/inspector` |

## Claude and the Agent SDK

| ID   | Title | URL | Used for | Status |
| ---- | ----- | --- | -------- | ------ |
| R-10 | Claude Agent SDK overview | https://code.claude.com/docs/en/agent-sdk | Runtime harness for headless runs. Package `@anthropic-ai/claude-agent-sdk`. Note: third-party products may not use claude.ai login; API key authentication only. | verified 2026-09-10 |
| R-11 | Claude Agent SDK TypeScript reference | https://code.claude.com/docs/en/agent-sdk/typescript | `query()`, `Options` (`model`, `allowedTools`, `disallowedTools`, `mcpServers`, `hooks`, `permissionMode`, `maxTurns`), `createSdkMcpServer()`, `tool()`, result message `usage` and `total_cost_usd`. | verified 2026-09-10 |
| R-12 | Claude Agent SDK hooks | https://code.claude.com/docs/en/agent-sdk/hooks | `PreToolUse` hooks registered as `hooks: { PreToolUse: [{ matcher, hooks: [cb] }] }`; callback returns `hookSpecificOutput: { permissionDecision: "allow" \| "deny" \| "ask" \| "defer", permissionDecisionReason, updatedInput }`. Basis of the money gate (D12). | verified 2026-09-10 |
| R-13 | Claude Agent SDK MCP configuration | https://code.claude.com/docs/en/agent-sdk/mcp | stdio, HTTP, and in-process SDK server configuration; tool naming `mcp__<server>__<tool>`; `allowedTools` wildcards; in-process servers never delay the first turn; MCP tool output over 25,000 tokens is spilled to a file. | verified 2026-09-10 |
| R-14 | Claude Agent SDK custom tools | https://code.claude.com/docs/en/agent-sdk/custom-tools | In-process tool definitions with `tool()` and Zod schemas (M12 task 12.6). The bundled MCP 1.x SDK converts each shape to JSON Schema when a client lists the tools, and cannot convert a Zod record: the list then fails whole (D48). | verified 2026-09-11; every tool listed and called over a real connection in `src/mcp/sdk.test.ts`, and driven for real by `bin/chip-run.ts` |
| R-15 | Claude Agent SDK cost tracking | https://code.claude.com/docs/en/agent-sdk/cost-tracking | Accuracy caveats on `total_cost_usd` used in run records (M14). `maxBudgetUsd` stops a run with subtype `error_max_budget_usd`, and the result message carries the cost before the SDK reports the error (D50). | verified 2026-09-11; both observed in real runs, one stopped at the ceiling and one finished at $3.41 |
| R-16 | Claude Agent SDK TypeScript changelog | https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md | Checked before upgrading the pinned SDK version. | from Anthropic reference |
| R-17 | Claude models overview | https://platform.claude.com/docs/en/about-claude/models/overview.md | Model IDs and context windows. Default model `claude-opus-5` (D11). | from Anthropic reference |
| R-18 | Claude pricing | https://platform.claude.com/docs/en/pricing.md | Cost estimates for eval runs. | from Anthropic reference |
| R-19 | Claude PDF support and vision | https://platform.claude.com/docs/en/build-with-claude/pdf-support.md and https://platform.claude.com/docs/en/build-with-claude/vision.md | Image content limits when `render_page` returns PNGs to the model. | from Anthropic reference |
| R-31 | Claude effort parameter | https://platform.claude.com/docs/en/build-with-claude/effort.md | `AGENT_EFFORT` values (`low` to `max`). | from Anthropic reference |
| R-32 | Claude tool use overview | https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview.md | Tool definition and result semantics behind MCP tools. | from Anthropic reference |
| R-33 | Building an eval for a Claude application | https://platform.claude.com/docs/en/ (eval guidance is bundled with Claude Code's `claude-api` skill) | Eval health checklist used in M16 task 16.5: task design, harness design, metrics hygiene, grader design, sensitivity. | from Anthropic reference |

## Tooling and libraries

| ID   | Title | URL | Used for | Status |
| ---- | ----- | --- | -------- | ------ |
| R-20 | Poppler | https://poppler.freedesktop.org/ | `pdftotext`, `pdftoppm`, `pdfinfo` (D08). Installed as `poppler-utils` 24.02.0 and exercised for real by the Module 6 tests. | verified 2026-09-10 |
| R-21 | TypeScript | https://www.typescriptlang.org/ | Language. Pinned to 6.0.3 (D17). | verified 2026-09-12; the site now advertises TypeScript 7.0 as current, and `typescript-eslint` 8.70.0 still declares a peer range of `>=4.8.4 <6.1.0`, so D17's pin stands until the linter moves |
| R-22 | Vitest | https://vitest.dev/ | Test runner, version 5.0.0 (D03). | verified 2026-09-12; the site documents the 5.x line |
| R-23 | Vitest coverage | https://vitest.dev/guide/coverage | Coverage providers: native `v8` and instrumented `istanbul`. The `thresholds.perFile` option this project depends on is in the config reference rather than this guide, and is exercised on every run of `npm run check`. | verified 2026-09-12; the guide covers the providers, not the thresholds |
| R-24 | typescript-eslint | https://typescript-eslint.io/users/configs | Shared configurations, version 8.70.0. The site names them `strict-type-checked` and `stylistic-type-checked`; the flat-config exports this project uses are `strictTypeChecked` and `stylisticTypeChecked`. | verified 2026-09-12 |
| R-25 | Prettier | https://prettier.io/ | Formatting, version 3.9.6. | verified 2026-09-12 |
| R-26 | GitHub Actions | https://docs.github.com/en/actions | CI (M0 task 0.11), on GitHub-hosted runners since D78. | verified by use 2026-09-13; every push since M0 has run the workflow, and the runs are visible in the repository |
| R-27 | better-sqlite3 | https://github.com/WiseLibs/better-sqlite3 | SQLite driver, version 13.0.3, prebuilt binaries for major platforms (D05). | verified 2026-09-10 |
| R-28 | fast-check | https://fast-check.dev/ | Property-based tests for parsers (M5), version 4.9.0. | verified 2026-09-12 |
| R-29 | pdf-lib | https://pdf-lib.js.org/ | Generating PDF test fixtures (M6), version 1.17.1. In use in `test/helpers/pdf-fixtures.ts`. | verified 2026-09-10 |
| R-30 | Mock Service Worker | https://mswjs.io/ | HTTP interception in tests (D07), version 2.15.0. Its handler types do not resolve under type-aware linting, so all usage goes through one boundary module (D22). | verified 2026-09-10 |
| R-34 | Zod | https://zod.dev/ | Schemas and validation (D06), version 4.6.1. | verified 2026-09-12; the site documents the stable 4.x line |
| R-35 | Node.js 22 documentation | https://nodejs.org/docs/latest-v22.x/api/ | Runtime APIs (`node:fs`, `node:crypto`, `node:child_process`, `fetch`). | verified 2026-09-12; the index covers all of them, currently at 22.23.2 |
| R-36 | simple-git-hooks | https://github.com/toplenboren/simple-git-hooks | Pre-push hook (M0 task 0.12), version 2.14.0. The hook is declared in the `simple-git-hooks` object in `package.json`, as the README describes. | verified 2026-09-12 |
| R-37 | tsx | https://github.com/privatenumber/tsx | Running TypeScript scripts under `scripts/` and `bin/`, version 4.23.13. | verified 2026-09-12 at the repository; `https://tsx.is/` fails certificate validation from this machine |
| R-70 | Playwright Test | https://playwright.dev/docs/intro | Browser tests for the web application (M19, D70), version 1.63.0. Drives Chromium headless; `toHaveScreenshot` provides the visual snapshots. | verified 2026-09-12; installed and running headless here |
| R-71 | Playwright on Linux distributions | https://playwright.dev/docs/browsers#install-system-dependencies | `playwright install-deps` supports Debian and Ubuntu only. It was why the Rocky Linux 10 runner verified Chromium's shared libraries rather than installing them; now it is why the browser job uses Playwright's own Ubuntu image, which already has them (D78). | verified 2026-09-12 |
| R-72 | Rocky Linux 10 | https://docs.rockylinux.org/ | The development platform: the WSL 2 distribution this is written on. It was also the build platform until D78 moved CI to hosted runners. | verified 2026-09-12 |
| R-73 | React | https://react.dev/ | The browser application (M19, D66), version 19.3.0 with `react-dom`. Not React Native: this renders to the DOM and is served as static assets by the project's own server. | verified 2026-09-12 |
| R-74 | Vite | https://vite.dev/ | Builds the front end into `dist/ui`, version 7.3.6. Asset names carry a content hash, which is what lets the static handler cache them for ever. | verified 2026-09-12 |
| R-75 | Recharts | https://recharts.org/ | The charting library (D66), version 3.10.1. `Cell` is deprecated in 3.x in favour of the `shape` prop, which is what this project uses. | verified 2026-09-12 |
| R-76 | Testing Library for React | https://testing-library.com/docs/react-testing-library/intro/ | Component tests under jsdom, version 16.3.3 with `user-event` 14 and `jest-dom` 6. | verified 2026-09-12 |
| R-77 | jsdom | https://github.com/jsdom/jsdom | The DOM the component tests run against, version 27.4.0. | verified 2026-09-12 |

## Domain references

| ID   | Title | URL | Used for | Status |
| ---- | ----- | --- | -------- | ------ |
| R-40 | AEC-Q100 | http://www.aecouncil.com/AECDocuments.html | Automotive qualification flag `aecQ100` and temperature grade rule (M11). | unverified (TLS handshake fails from this machine, 2026-09-12). The flag is never read from here: it is taken from each datasheet's own qualification statement and orderable list, and two golden parts carry it |
| R-41 | Texas Instruments product pages | https://www.ti.com/ | Datasheets and ordering guides for TI parts in the golden set. | verified by use 2026-09-12; serves PDFs to a plain client at `ti.com/lit/ds/symlink/<part>.pdf` and `ti.com/lit/gpn/<part>`, and thirteen golden parts were read from them |
| R-42 | Monolithic Power Systems | https://www.monolithicpower.com/ | Datasheets for MPS parts. | verified by use 2026-09-11 and found unusable: every document URL returns an HTML viewer rather than a PDF, so no MPS part is in the golden set (D46). The MPN decoder for MPS suffixes stands on R-65 instead |
| R-43 | Diodes Incorporated | https://www.diodes.com/ | Datasheets for AP-series parts in the golden set. | verified by use 2026-09-12; serves PDFs at `diodes.com/assets/Datasheets/...`, and five golden parts were read from them |
| R-44 | Analog Devices | https://www.analog.com/ | Datasheets for LT and MAX parts. | verified by use 2026-09-11 and found unusable: the request is refused, and Digi-Key's own link for `LT8610AEMSE-PBF` points at the LTpowerCAD help file rather than the datasheet. No ADI part is in the golden set (D46) |
| R-45 | Richtek | https://www.richtek.com/ | Datasheets for RT parts. | unverified, and unused: no Richtek part is in the golden set. The row is kept because `src/mpn/decoders/richtek.ts` decodes RT part numbers, and that stands on the recorded corpus rather than on this page |
| R-46 | onsemi | https://www.onsemi.com/ | Datasheets for NCP parts. | verified by use 2026-09-11 and found unusable: document URLs redirect to a landing page rather than serving a PDF, so no onsemi part is in the golden set (D46) |
| R-47 | Microchip | https://www.microchip.com/ | Datasheets for MCP parts in the golden set. | verified by use 2026-09-11; serves PDFs to a plain client, and `MCP16331T-E/CH` was read from one |
| R-48 | STMicroelectronics | https://www.st.com/ | Datasheets for ST parts. | verified by use 2026-09-11 and found unusable: the request is refused, so no ST part is in the golden set (D46). The MPN decoder for ST suffixes stands on the recorded corpus |

## Part-number nomenclature (Module 10)

Sources for what a suffix means. Where one of these contradicts the recorded
corpus, the corpus decides what is claimed and the contradiction is recorded
in `src/mpn/README.md`; where the corpus cannot see a distinction at all, only
these can.

| ID   | Title | URL | Used for | Status |
| ---- | ----- | --- | -------- | ------ |
| R-62 | TI Analog and Logic Packaging Guide (SSZB138) | https://www.ti.com/lit/pdf/sszb138 | TI package designators against pin counts. Lists `D` as SOIC in 8, 14 and 16 leads, `DBV` as SOT-23 in 5 and 6, `RHL` as a 24-lead VQFN, `DCN` as SOT-23-8, `DRV` as WSON-6, `RTE` as WQFN-16, `RTW` as WQFN-24, `DRL` as a 6-lead SOT. Four pin-count claims were removed because of it. | verified 2026-09-11 (fetched, read with `pdftotext`) |
| R-63 | Digi-Key TechForum: TI TPS series suffix options | https://forum.digikey.com/t/texas-instruments-tps-series-suffix-options/10484 | TI reel codes: `R` is a 3,000-part reel, `T` a 250-part reel. Both are tape and reel. | verified 2026-09-11 |
| R-64 | Digi-Key TechForum: Analog Devices I vs E temperature spec | https://forum.digikey.com/t/analog-devices-inc-i-vs-e-temperature-spec/11958 | Linear Technology grade letters. `E` operates from -40 °C but is only guaranteed from 0 °C, the rest assured by design; `I` is guaranteed across -40 to 125 °C. Source of the `guaranteed` field on `TemperatureGrade`, which the corpus could not have shown: Digi-Key reports both grades as -40 to 125 °C. | verified 2026-09-11 |
| R-65 | Digi-Key TechForum: MPS reel suffixes P and Z | https://forum.digikey.com/t/monolithic-power-systems-reel-suffixes-p-z/413 | MPS `-Z` is a full reel of 2,500 to 5,000 parts and `-P` a 500-part reel. Both are therefore decoded as `reel`, where they had been recorded as uninterpreted suffixes. | verified 2026-09-11 |
| R-66 | Diodes Incorporated packaging and automotive suffixes | https://www.diodes.com/part/view/AP63203Q | Diodes `-7` is a 7-inch reel and `-13` a 13-inch reel; a `Q` before the package code marks an AEC-Q100 qualified part. | verified 2026-09-11 |

## Project documents

| ID   | Title | Path | Purpose |
| ---- | ----- | ---- | ------- |
| R-50 | Project brief | `CLAUDE.md` | Scope, architecture, non-negotiables. |
| R-51 | Project plan and history | `docs/PROJECT_PLAN.md` | Decisions, status, session log, open questions. |
| R-52 | Completion plan | `docs/COMPLETION_PLAN.md` | Module-by-module task list and Definition of Done. |
| R-54 | Architecture | `docs/ARCHITECTURE.md` | How the system works: layers, pipeline, module responsibilities, and the seams. |
| R-53 | Repository | https://github.com/GavinMGlynn/cpu_datasheet_agent | Private repository. Every commit is pushed here (D15). |
| R-78 | scrypt (RFC 7914) | https://www.rfc-editor.org/rfc/rfc7914 | The password hash (20B), through `node:crypto.scrypt`. N=2^15, r=8, p=1 follows the RFC's own guidance for interactive use. | verified 2026-09-12 |
| R-79 | OpenID Connect Core 1.0 | https://openid.net/specs/openid-connect-core-1_0.html | Single sign-on (20E): the authorization code flow, the ID token, and every claim checked before it is believed. | verified 2026-09-12 |
| R-80 | OpenID Connect Discovery 1.0 | https://openid.net/specs/openid-connect-discovery-1_0.html | `/.well-known/openid-configuration`, which is how the endpoints and the key set are found rather than configured. | verified 2026-09-12 |
| R-81 | PKCE (RFC 7636) | https://www.rfc-editor.org/rfc/rfc7636 | S256 code challenge on the authorization request, so an intercepted code is worth nothing without the verifier. | verified 2026-09-12 |
| R-82 | JSON Web Signature (RFC 7515) and JWK (RFC 7517) | https://www.rfc-editor.org/rfc/rfc7515 | The ID token's signature and the issuer's published keys; `src/auth/jwt.ts` implements RS256 and ES256 against these. | verified 2026-09-12 |
| R-83 | OWASP Password Storage Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html | Why scrypt with these parameters, why length and not composition rules, and why the hash carries its own cost. | verified 2026-09-12 |
| R-84 | Self-hosted runner security | https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access#self-hosted-runner-security | GitHub recommends against self-hosted runners on public repositories, because a fork's pull request runs its own workflow code on the machine. The reason for D78. | verified 2026-09-13 |
| R-85 | Playwright Docker image | https://playwright.dev/docs/docker | `mcr.microsoft.com/playwright:v<version>-noble` carries the browsers, their libraries and a fixed font stack. The screenshot baselines are taken inside it so anyone can reproduce them (D78). | verified by use 2026-09-13 |
| R-86 | GNU General Public License v3.0 | https://www.gnu.org/licenses/gpl-3.0.txt | The licence this project is published under, verbatim in `LICENSE`; section 7 is the additional permission covering the Claude Agent SDK (D79). | verified 2026-09-13 |
| R-87 | Claude Agent SDK licence | https://code.claude.com/docs/en/legal-and-compliance | The harness is Anthropic's proprietary software — "all rights reserved", not open source — which is what D79's additional permission is about. | verified 2026-09-13 |
