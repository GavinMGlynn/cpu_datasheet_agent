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

## 4. Status

Legend: **not started**, **in progress**, **complete** (all Definition of Done
items in `COMPLETION_PLAN.md` satisfied).

| Module | Name | Status | Completed on |
| ------ | ---- | ------ | ------------ |
| M0  | Foundation and tooling | complete | 2026-09-10 |
| M1  | Domain model and validation | in progress | |
| M2  | Structured logging and tool-call ledger | not started | |
| M3  | Content-addressed cache | not started | |
| M4  | Persistence (SQLite) | not started | |
| M5  | Units, parsing, and normalisation | not started | |
| M6  | PDF toolkit | not started | |
| M7  | Digi-Key adapter | not started | |
| M8  | Mouser adapter | not started | |
| M9  | Nexar adapter with hard budget | not started | |
| M10 | MPN resolution | not started | |
| M11 | Reconciliation and classification | not started | |
| M12 | Tool registry and MCP server | not started | |
| M13 | Golden evaluation set | not started | |
| M14 | Agent runner (extraction) | not started | |
| M15 | Verification pass | not started | |
| M16 | Evaluation harness | not started | |
| M17 | Alternates query | not started | |
| M18 | Release and end-to-end sign-off | not started | |

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

### 2026-09-10 — Session 3: Module 1 built, awaiting CI

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

**Next**

- Confirm CI green, mark M1 complete, start M2 (logging and ledger).

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
| Q5 | Default model `claude-opus-5` at effort `high` for extraction and verification (D11). Acceptable cost-wise? | M14 | open (assumed yes) |
