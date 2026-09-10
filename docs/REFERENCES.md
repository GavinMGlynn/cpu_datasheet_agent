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
| R-02 | Digi-Key Product Information v4, ProductSearch endpoints | https://developer.digikey.com/products/product-information-v4/productsearch | Endpoint index: `KeywordSearch` (POST), `ProductDetails`, `ProductPricing`, `PricingOptionsByQuantity`, `Media`, `Substitutions`, `AlternatePackaging`, `RecommendedProducts`, `Associations`, `Manufacturers`, `Categories`, `CategoriesById`, `DigiReelPricing` (GET), `PackageTypeByQuantity` (deprecated). Exact paths, base URLs, headers, and rate limits are on the per-endpoint pages and must be recorded in M7 task 7.3. | verified 2026-09-10 (index only) |
| R-60 | Digi-Key OAuth 2.0 2-legged flow | https://developer.digikey.com/tutorials-and-resources/oauth-20-2-legged-flow | Client-credentials token flow for Module 7 task 7.1. Token endpoints: production `https://api.digikey.com/v1/oauth2/token`, sandbox `https://sandbox-api.digikey.com/v1/oauth2/token`. POST `application/x-www-form-urlencoded` with `client_id`, `client_secret`, `grant_type=client_credentials`. Response carries `access_token`, `expires_in` (600 seconds), `token_type` `Bearer`. Calls send `Authorization: Bearer <token>` plus `X-DIGIKEY-Client-Id` and the locale headers. | verified 2026-09-10 |
| R-03 | Mouser API hub | https://www.mouser.com/api-hub/ | Mouser Search API: part-number and keyword search, pricing, availability, datasheet URL. API key obtained here. | unverified (request timed out 2026-09-10; re-check in M8 task 8.1) |
| R-04 | Mouser API documentation (Swagger UI) | https://api.mouser.com/api/docs/ui/index | Endpoint paths and request/response shapes for the Search API. | unverified (page content not rendered 2026-09-10) |
| R-05 | Nexar API support and documentation | https://support.nexar.com/ | Nexar (Octopart) supply data: cross-distributor offers and datasheet URLs. `https://docs.nexar.com/` redirects here. Articles "Introduction to the Nexar API" and "Make Your First Octopart Supply Data Query" hold the endpoint and query details needed for M9 task 9.1. | verified 2026-09-10 (landing page only) |
| R-06 | Nexar plan limits | https://nexar.com/api | Evaluation tier is 100 parts lifetime; free tier about 1000 matched parts. Source of the hard budget in D13. | unverified (limit taken from `CLAUDE.md`; confirm in M9) |

## Model Context Protocol

| ID   | Title | URL | Used for | Status |
| ---- | ----- | --- | -------- | ------ |
| R-07 | MCP TypeScript SDK repository | https://github.com/modelcontextprotocol/typescript-sdk | v2 stable line, packages `@modelcontextprotocol/server` (2.0.0) and `@modelcontextprotocol/client` (2.0.0), `McpServer` class. Targets the 2026-07-28 MCP spec. The 1.x line is `@modelcontextprotocol/sdk`. | verified 2026-09-10 |
| R-08 | Model Context Protocol specification and docs | https://modelcontextprotocol.io/ | Protocol semantics: tools, resources, stdio transport, error results. | unverified |
| R-09 | MCP Inspector | https://github.com/modelcontextprotocol/inspector | Manual check of the stdio server in M12 task 12.9. | unverified |

## Claude and the Agent SDK

| ID   | Title | URL | Used for | Status |
| ---- | ----- | --- | -------- | ------ |
| R-10 | Claude Agent SDK overview | https://code.claude.com/docs/en/agent-sdk | Runtime harness for headless runs. Package `@anthropic-ai/claude-agent-sdk`. Note: third-party products may not use claude.ai login; API key authentication only. | verified 2026-09-10 |
| R-11 | Claude Agent SDK TypeScript reference | https://code.claude.com/docs/en/agent-sdk/typescript | `query()`, `Options` (`model`, `allowedTools`, `disallowedTools`, `mcpServers`, `hooks`, `permissionMode`, `maxTurns`), `createSdkMcpServer()`, `tool()`, result message `usage` and `total_cost_usd`. | verified 2026-09-10 |
| R-12 | Claude Agent SDK hooks | https://code.claude.com/docs/en/agent-sdk/hooks | `PreToolUse` hooks registered as `hooks: { PreToolUse: [{ matcher, hooks: [cb] }] }`; callback returns `hookSpecificOutput: { permissionDecision: "allow" \| "deny" \| "ask" \| "defer", permissionDecisionReason, updatedInput }`. Basis of the money gate (D12). | verified 2026-09-10 |
| R-13 | Claude Agent SDK MCP configuration | https://code.claude.com/docs/en/agent-sdk/mcp | stdio, HTTP, and in-process SDK server configuration; tool naming `mcp__<server>__<tool>`; `allowedTools` wildcards; in-process servers never delay the first turn; MCP tool output over 25,000 tokens is spilled to a file. | verified 2026-09-10 |
| R-14 | Claude Agent SDK custom tools | https://code.claude.com/docs/en/agent-sdk/custom-tools | In-process tool definitions with `tool()` and Zod schemas (M12 task 12.6). | unverified |
| R-15 | Claude Agent SDK cost tracking | https://code.claude.com/docs/en/agent-sdk/cost-tracking | Accuracy caveats on `total_cost_usd` used in run records (M14). | unverified |
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
| R-21 | TypeScript | https://www.typescriptlang.org/ | Language. Pinned to 6.0.3 (D17); 7.0.2 is outside the linter peer range. | unverified |
| R-22 | Vitest | https://vitest.dev/ | Test runner, version 5.0.0 (D03). | unverified |
| R-23 | Vitest coverage | https://vitest.dev/guide/coverage | `@vitest/coverage-v8`, per-file thresholds. | unverified |
| R-24 | typescript-eslint | https://typescript-eslint.io/ | Lint rules `strictTypeChecked` and `stylisticTypeChecked`, version 8.70.0. | unverified |
| R-25 | Prettier | https://prettier.io/ | Formatting, version 3.9.6. | unverified |
| R-26 | GitHub Actions | https://docs.github.com/en/actions | CI (M0 task 0.11). | unverified |
| R-27 | better-sqlite3 | https://github.com/WiseLibs/better-sqlite3 | SQLite driver, version 13.0.3, prebuilt binaries for major platforms (D05). | verified 2026-09-10 |
| R-28 | fast-check | https://fast-check.dev/ | Property-based tests for parsers (M5), version 4.9.0. | unverified |
| R-29 | pdf-lib | https://pdf-lib.js.org/ | Generating PDF test fixtures (M6), version 1.17.1. In use in `test/helpers/pdf-fixtures.ts`. | verified 2026-09-10 |
| R-30 | Mock Service Worker | https://mswjs.io/ | HTTP interception in tests (D07), version 2.15.0. Its handler types do not resolve under type-aware linting, so all usage goes through one boundary module (D22). | verified 2026-09-10 |
| R-34 | Zod | https://zod.dev/ | Schemas and validation (D06), version 4.6.1. | unverified |
| R-35 | Node.js 22 documentation | https://nodejs.org/docs/latest-v22.x/api/ | Runtime APIs (`node:fs`, `node:child_process`, `fetch`). | unverified |
| R-36 | simple-git-hooks | https://github.com/toplenboren/simple-git-hooks | Pre-push hook (M0 task 0.12), version 2.14.0. | unverified |
| R-37 | tsx | https://tsx.is/ | Running TypeScript scripts under `scripts/` and `bin/`, version 4.23.13. | unverified |

## Domain references

| ID   | Title | URL | Used for | Status |
| ---- | ----- | --- | -------- | ------ |
| R-40 | AEC-Q100 | http://www.aecouncil.com/AECDocuments.html | Automotive qualification flag `aecQ100` and temperature grade rule (M11). | unverified |
| R-41 | Texas Instruments product pages | https://www.ti.com/ | Datasheets and ordering guides for TI parts in the golden set. | unverified |
| R-42 | Monolithic Power Systems | https://www.monolithicpower.com/ | Datasheets for MPS parts in the golden set. | unverified |
| R-43 | Diodes Incorporated | https://www.diodes.com/ | Datasheets for AP-series parts in the golden set. | unverified |
| R-44 | Analog Devices | https://www.analog.com/ | Datasheets for LT and MAX parts in the golden set. | unverified |
| R-45 | Richtek | https://www.richtek.com/ | Datasheets for RT parts in the golden set. | unverified |
| R-46 | onsemi | https://www.onsemi.com/ | Datasheets for NCP parts in the golden set. | unverified |
| R-47 | Microchip | https://www.microchip.com/ | Datasheets for MCP parts in the golden set. | unverified |
| R-48 | STMicroelectronics | https://www.st.com/ | Datasheets for ST parts in the golden set. | unverified |

## Project documents

| ID   | Title | Path | Purpose |
| ---- | ----- | ---- | ------- |
| R-50 | Project brief | `CLAUDE.md` | Scope, architecture, non-negotiables. |
| R-51 | Project plan and history | `docs/PROJECT_PLAN.md` | Decisions, status, session log, open questions. |
| R-52 | Completion plan | `docs/COMPLETION_PLAN.md` | Module-by-module task list and Definition of Done. |
| R-53 | Repository | https://github.com/GavinMGlynn/cpu_datasheet_agent | Private repository. Every commit is pushed here (D15). |
