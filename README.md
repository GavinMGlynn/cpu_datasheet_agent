# Chip Datasheet + Pricing Agent

**A project to learn how to build an agent and an MCP server with Claude.**

It is a real one rather than a toy: given a chip part number, it downloads the
datasheet, extracts parameters with page-level provenance, pulls distributor
pricing, reconciles the two, and categorises the part. Buck regulators first.
The point of building it was to find out what an agent is actually made of —
the tool surface, the run loop, the money gates, the ledger, the separate
verification pass, and how any of it can be tested — so the parts that are
usually hidden in a framework are written out in full here.

**Start with `docs/tutorial/index.html`.** It is a step-by-step tour, with
diagrams, of how the agent and the MCP server work, written for someone who
knows Node and React and has used Claude but has not built either. Open it in
a browser, or run the site and follow "How this works" in the sidebar.

Then `CLAUDE.md` for the brief, and `docs/` for the plan, the task list, the
architecture and the references.

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

## The site

```bash
npm run build:ui                                  # once, and after a UI change
npx tsx bin/chip-auth.ts add <name> --role admin  # once: prompts for a password
npm run web                                       # then open http://127.0.0.1:5174
npm run web:snapshot                              # one shareable file, no server
```

Everything above, read across all of it at once: the parts and what was found
for each, the datasheets with the pages a value was taken from, spend by day,
model and part, tool latencies and failures, the evaluation scores, and the
golden set. Corrections are written back with an audit row saying who changed
what and why, and runs can be started from the page under the same money gates
the CLI uses plus a ceiling for the launch.

Signing in is a username and a password against accounts kept in
`data/auth.sqlite` — scrypt hashes, server-side sessions in HttpOnly cookies,
and two roles: a viewer reads, an admin changes things and spends money.
Single sign-on against an OpenID Connect issuer is optional and off until one
is configured. It binds to the loopback interface; `--host` anything else is
announced before it binds. `src/auth/README.md` has the identity model and
`src/web/README.md` the endpoints and the errors.

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
| `npm run build:ui` | Build the front end into `dist/ui`. |
| `npm run web` | Serve the site on 127.0.0.1:5174. |
| `npm run web:snapshot` | Write a shareable snapshot to `dist/snapshot/index.html`. |
| `npm run test:e2e` | Playwright against a seeded temporary data directory. |

A `pre-push` git hook runs `npm run check`.

## How it is tested

Five layers, and each one answers a question the one below it cannot:

1. **Unit tests** — 3,200-odd, with 100% per-file coverage enforced and a
   static gate that fails on `TODO`, `.skip`, `.only` or `any`.
2. **Integration tests** — the real HTTP server over a real SQLite database in
   a temporary directory.
3. **Browser tests** — Playwright drives the built site, signing in through
   the form the way a person does.
4. **Screenshots** — every page compared against a committed baseline.
5. **Live contract tests** — opt-in, against the real distributor APIs, to
   catch the day a response shape changes.

CI runs all of it on GitHub-hosted runners. The screenshots are the fussy
layer — a baseline is a photograph of one machine's fonts — so they are taken
inside a pinned container, which means you can reproduce them:

```bash
docker run --rm -v "$PWD":/w -w /w mcr.microsoft.com/playwright:v1.63.0-noble \
  bash -c 'apt-get update -qq && apt-get install -y -qq poppler-utils &&
           npm ci && npm run build:ui &&
           SNAPSHOT_PLATFORM=playwright-noble CI=true npm run test:e2e'
```

A local run without that container writes its baselines to
`test/e2e/__screenshots__/local/`, which is not committed.

## What it will not do

- **No scraping.** Distributor data comes from documented APIs with a key, or
  not at all. Octopart's and the distributors' web interfaces are off limits.
- **No value without provenance.** A datasheet-sourced parameter carries the
  page it came from, or it is not stored.
- **No guessing.** Conflicting values, an ambiguous part number or an
  unreadable safety-relevant rating go to a human instead of a best effort.
- **No spending by accident.** A run that has not been told it may spend
  answers from the cache and reports a miss rather than making the call.

It is a personal learning project, not a product, and it is not affiliated
with or endorsed by Anthropic, Digi-Key, Mouser or any manufacturer. Nothing
it extracts should be trusted for a design decision without reading the
datasheet yourself: a wrong V(DS) max is a dead board.

## Licence

Copyright (C) 2026 Gavin Glynn.

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. It is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR
A PARTICULAR PURPOSE. See the GNU General Public License in `LICENSE` for more
details.

**Additional permission under GNU GPL version 3 section 7.** If you modify
this program, or any covered work, by linking or combining it with the Claude
Agent SDK (`@anthropic-ai/claude-agent-sdk`) and the Claude Code binaries it
carries, or with a modified version of those, you may convey the resulting
work. That software is Anthropic's and is licensed under its own terms, not
under this licence; running this program means agreeing to those terms as
well.

The datasheets it downloads, the pages it renders and the distributor
responses it caches belong to the manufacturers and distributors they came
from. They stay out of this repository — `cache/`, `data/` and
`eval/golden/work/` are all ignored — and the shareable snapshot excludes them
in code.

## Layout

See `docs/PROJECT_PLAN.md` section 5.
