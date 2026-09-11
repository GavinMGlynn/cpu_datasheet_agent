# Chip Datasheet + Pricing Agent

An agent that, given a chip part number, downloads its datasheet, extracts
parameters with page-level provenance, pulls distributor pricing, reconciles
the two, and categorises the part. Buck regulators first.

Read `CLAUDE.md` for the brief and `docs/` for the plan, the task list, and
the references.

## What it does

```bash
# extract one part, or a list of them, from its datasheet
npx tsx bin/chip-run.ts extract TPS54331DR
npx tsx bin/chip-run.ts extract-many parts.txt

# check every stored value against the page it cites, in a fresh context
npx tsx bin/chip-run.ts verify TPS54331DR
npx tsx bin/chip-run.ts verify-pending

# find a cheaper part that still meets the constraints
npx tsx bin/chip-run.ts alternates TPS54331DR --vin 8-28 --iout 2 --qty 100

# score the pipeline against the hand-read golden set
npx tsx bin/chip-eval.ts run
npx tsx bin/chip-eval.ts compare eval/results/<a> eval/results/<b>

# serve the same tools over MCP, for Claude Code or any MCP client
npx tsx bin/chip-mcp.ts
```

A run spends nothing unless it is told to: distributor calls are answered from
the cache and a miss comes back as `needs_confirmation` rather than a charge.
`--allow-spend` permits them, and a per-run cost ceiling stops the model
calls whatever the run is doing.

The current baseline — `extract.v1` on `claude-opus-5`, all 22 golden parts —
is 90.6% recall, 90.6% precision, 59.3% of citations on the exact page, for
$87.24. `eval/results/` holds the report.

## Setup

Requirements: Node 22.12 or later, npm, poppler (`pdftotext`, `pdftoppm`,
`pdfinfo`).

```bash
# Rocky / Fedora
sudo dnf install -y poppler-utils
# Debian / Ubuntu
sudo apt-get install -y poppler-utils

npm ci
cp .env.example .env   # then fill in credentials as they become needed
```

## Commands

| Command | What it does |
| ------- | ------------ |
| `npm run check` | Everything CI runs: format check, lint, typecheck, tests with 100% per-file coverage, static gate. |
| `npm test` | Unit tests. |
| `npm run test:coverage` | Unit tests with the coverage gate. |
| `npm run test:live` | Opt-in live contract tests against real APIs (through the cache). |
| `npm run lint` / `npm run typecheck` / `npm run format` | Individual checks. |
| `npm run gate` | Static scan for forbidden tokens in code directories. |
| `npm run build` | Emit JavaScript to `dist/`. |

A `pre-push` git hook runs `npm run check`.

## Layout

See `docs/PROJECT_PLAN.md` section 5.
