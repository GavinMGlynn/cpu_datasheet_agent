# Chip Datasheet + Pricing Agent

An agent that, given a chip part number, downloads its datasheet, extracts
parameters with page-level provenance, pulls distributor pricing, reconciles
the two, and categorises the part. Buck regulators first.

Read `CLAUDE.md` for the brief and `docs/` for the plan, the task list, and
the references.

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
