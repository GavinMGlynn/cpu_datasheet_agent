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
3. `docs/ARCHITECTURE.md` — how the system works: the pieces, what each
   owns, and how they interact. Read this before changing a module boundary.
4. `docs/REFERENCES.md` — every external source we rely on, with its
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

Modules M0 to M17 are complete: schemas, ledger, cache, SQLite, units, the
PDF toolkit, the Digi-Key and Mouser adapters, the part report generator, MPN
resolution, reconciliation and classification, the tool registry and MCP
server, the golden evaluation set, the extraction runner, the verification pass, and
the evaluation harness, and the alternates query. M9 (Nexar) is deferred, see D29. `docs/PROJECT_PLAN.md` section 4 is the
authoritative status table.

- An extraction runs headless: `npx tsx bin/chip-run.ts extract <mpn>`. Money
  is gated three ways (D12, D49, D50) and a run that may not spend answers
  from the cache. One real run of TPS54331DR scored 92% recall and 92%
  precision against its golden file, for $3.41.
- A verification pass checks it in a fresh context:
  `npx tsx bin/chip-run.ts verify <mpn>`. Its first real run confirmed 29 of
  30 values for $0.45 and caught a wrong page citation the extraction could
  not have noticed.
- `chip-mcp-server.ts` was written earlier but is not in this repository (see
  `docs/PROJECT_PLAN.md` open question Q3). Its schema and tool definitions
  are to be reconciled against Module 12 of `docs/COMPLETION_PLAN.md`.
- `npx tsx bin/chip-eval.ts run` scores the golden set end to end, offline
  except for the model calls, and writes a report under `eval/results/`. The
  first baseline — `extract.v1` on `claude-opus-5`, all 22 parts — scored 90.6%
  recall, 90.6% precision and 59.3% exact citations for $87.24.
- `npx tsx bin/chip-run.ts alternates <mpn> --vin 8-28 --iout 2 --qty 100`
  answers from stored parts, with every difference listed and the
  pin-compatibility disclaimer in the answer.

## Next steps

1. M18: release and end-to-end sign-off.

## Deferred

AWS hosting (Fargate + S3 cache + Secrets Manager + SQS work queue). Not until
it runs reliably locally. Do not start here.
