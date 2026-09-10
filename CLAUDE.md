# Chip Datasheet + Pricing Agent

## What this is

An agent that, given a chip part number, downloads its datasheet, extracts
parameters, pulls distributor pricing, and categorises the part along multiple
axes. The end goal is answering questions like "find me a cheaper alternate to
this buck regulator that still meets my Vin range".

This is a learning project as much as a working one — the point is to build a
real agent with real tool use, not to wrap an API.

## Working documents

Read these in order at the start of every session:

1. `docs/PROJECT_PLAN.md` — decisions, current status, session log, open
   questions. The pick-up and put-down checklists live here.
2. `docs/COMPLETION_PLAN.md` — every task to 100%, in modules completed
   strictly in order. No MVP; a module is finished before the next starts.
3. `docs/REFERENCES.md` — every external source we rely on, with its
   verification status. Cite rows by ID.

Every documentation change is committed and pushed immediately. Every
commit is pushed.

## Stack

- TypeScript / Node, running in WSL 2 on Windows 11
- MCP server exposing the tool surface (`chip-mcp-server.ts`)
- `@anthropic-ai/claude-agent-sdk` as the runtime harness for headless runs
- SQLite locally; Postgres if/when this moves to AWS
- poppler (`pdftotext`, `pdftoppm`) for PDF handling

## Architecture

Two layers, kept strictly separate:

**Deterministic layer** — fetching, caching, persisting. No judgement here.
Every network call caches to disk keyed by a hash, so reruns are free and
prompt iteration doesn't burn API quota. This is isolated in one `cached()`
function specifically so it can later be swapped to S3.

**Agent layer** — the only genuinely hard step is extracting parameters from
datasheet PDFs and reconciling them against distributor parametric data.
Everything else is plumbing.

Loop: resolve MPN → fetch offers → fetch datasheet → extract parameters →
normalise units and reconcile → classify → persist → **separate verify pass**
in a fresh context, checking each stored value against its cited page.
Extraction and verification must not share a context.

## Data sources

- **Digi-Key Product Information v4** — free key, OAuth2. Rich parametrics plus
  a PricingByQuantity endpoint. One distributor only. Primary source.
- **Nexar / Octopart GraphQL** — cross-distributor aggregation, returns the
  datasheet URL directly. HARD LIMIT: the Evaluation tier is 100 parts total,
  lifetime, not per month. Free tier is ~1000 matched parts. Treat every call
  as expensive.
- **Mouser API** — free, but pricing/availability from Mouser listings only.
- Do NOT scrape octopart.com or distributor web UIs. Bot-walled, and against
  their terms. APIs only.

## Non-negotiables

1. **Every extracted parameter carries provenance.** Datasheet-sourced values
   require a page number. No page number, no store.
2. **`upsert_part` validates and rejects — it never coerces.** If the agent
   produces `"3 V to 32 V"` where a min/max pair was expected, that must fail
   loudly.
3. **Escalate, don't guess.** Conflicting datasheet/distributor values, an MPN
   resolving to several plausible parts, or an unreadable safety-relevant
   rating all go to `ask_human`. A wrong Vds max is a dead board.
4. **Log every tool call, inputs and outputs.** This becomes the eval dataset
   and cannot be reconstructed retroactively.

## Known gotchas

- One datasheet commonly covers a whole product family — dozens of MPNs
  differentiated only by an ordering-information table. "The datasheet for this
  MPN" is usually a lie.
- Dense electrical-characteristics tables mangle badly through `pdftotext`.
  When columns look misaligned or values are orphaned from their conditions,
  render the page to an image and read it visually instead.
- MPN suffixes encode packaging, temperature grade and tape-and-reel. Naive
  string matching produces confident wrong answers.
- Parametric similarity does not imply pin compatibility. Any alternate
  suggestion must say so explicitly.

## Scope discipline

Start with ONE component category — buck regulators or small MCUs. The
parameter schema explodes if you try to be general early, and you learn
nothing from a schema you can't validate.

## Current state

- `chip-mcp-server.ts` was written earlier but is not in this repository (see
  `docs/PROJECT_PLAN.md` open question Q3). Its schema and tool definitions
  are to be reconciled against Module 12 of `docs/COMPLETION_PLAN.md`.
- Nothing built yet: PDF extraction, the eval harness, the agent runner.

## Next steps

1. Implement `digikeySearch` and `digikeyPricing` against the Digi-Key v4 API.
2. Implement `fetchPdf`, `read_pages` (pdftotext -layout), `render_page`
   (pdftoppm at 200dpi).
3. Hand-characterise 20 parts as a golden eval set before trusting any
   extraction output.
4. Build the agent runner on the Agent SDK; add a PreToolUse hook gating
   anything that spends money.

## Deferred

AWS hosting (Fargate + S3 cache + Secrets Manager + SQS work queue). Not until
it runs reliably locally. Do not start here.
