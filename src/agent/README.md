# agent

The extraction runner: one part number through one headless run on the Claude
Agent SDK, with money gated and every decision recorded (Module 14). Import
from `src/agent/index.ts`.

## A run

```
npx tsx bin/chip-run.ts extract TPS54331DR
npx tsx bin/chip-run.ts extract TPS54331DR --allow-spend --effort max
npx tsx bin/chip-run.ts extract-many parts.txt --force
```

`extractPart(mpn, runConfig, deps)` does the work; `main(argv, deps)` is the
command line over it. Exit codes are 0 when every run reached a conclusion, 1
when one did not, and 2 when the command line or the configuration was wrong.

The run is given:

- the tool surface as an **in-process MCP server** (M12), mounted as `chip`,
  so a tool is `mcp__chip__read_pages`;
- **no built-in tools at all** (`tools: []`) and no settings files
  (`settingSources: []`). A run is the prompt file, the tools, and nothing
  else, or the same prompt version means two different things on two machines;
- a **turn limit** and a **cost ceiling**, both enforced by the harness;
- the **`PreToolUse` money gate**.

## The money gate

Three parts, because one is not enough (D12):

1. `spendsQuota` on the tool, enforced by the registry against the run's
   `QuotaPolicy`. Protects against every client.
2. The `PreToolUse` hook, `createSpendGate`. Protects against this agent.
3. `maxBudgetUsd`, enforced by the harness on the model calls themselves. The
   agent cannot reach it at all.

The hook's rules, in order: anything that is not a `chip` tool is denied; a
tool that spends nothing is allowed; a spending tool in a run that may spend
is allowed **with `confirmSpend: true` written into its input**, because the
budget was approved once for the run rather than per call; a spending tool in
a run that may not spend is allowed **unchanged**, so it answers from the
cache and reports a miss as `needs_confirmation`; and the same call asking to
spend anyway is denied. That last one is the gate: the only way to spend is a
run started with `--allow-spend`.

Letting a cache-only call through is deliberate. The alternative — denying
every spending tool outright — would stop a no-spend run from reading data
already paid for, and being able to rerun a part for free is the point of the
cache (D40).

The run's quota policy and its `allowSpend` must agree: `extractPart` refuses
to start when the context it was given says otherwise, because one of the two
would then be enforcing a budget nobody set.

## Prompts

`prompts/extract.v1.md` is the system prompt. `loadPrompt(version)` reads it
and returns its text with a digest, which the run's ledger entry records:
prompt text is versioned, never edited, and the digest is what proves it.

A test snapshots the prompt and checks that every tool it names exists. A
prompt that walks the agent through a renamed tool is a run that wastes a
turn finding out.

## What a run leaves behind

- **A `runs` row** (`RunRepository`), written before the first message and
  completed after the last. A run that never came back is a row with no
  result rather than nothing at all.
- **A ledger entry** `extract_part` holding the condensed transcript, with
  every tool call and every gate decision recorded beneath it as children.
  That parent id is how one run's calls are counted among a batch's.
- **Whatever the tools did**: a stored part, escalations, cached downloads.

`RunResult` is the run's achievement for the part: `extracted` when it
finished cleanly and stored one, `needs_human` when it left a question —
stored or not, because the part is in the database with that status and the
question is what it is waiting on — and `rejected` for anything else, with
the reason kept.

A failed run is not an exception. A harness that crashed, a model that ran out
of turns and a part stored cleanly are all endings, and all three are recorded
the same way. `extractPart` throws only when the run could not be set up: an
unknown prompt version, a part number that is not one, a policy that
disagrees with itself.

## Batches

`extractMany(mpns, config, deps, { force })` runs the list sequentially — the
runs share one cache, one database and one ledger, and a part whose datasheet
another part already fetched should find it there rather than race for it.

It is resumable: a part with a finished run under this prompt version is
skipped, so a batch that stopped halfway is restarted by running it again.
`--force` runs everything regardless.

## Errors

| Code | Means |
| --- | --- |
| `RUN_POLICY_MISMATCH` | The tool context's quota policy contradicts the run's `allowSpend`. |
| `CLI_USAGE` | The command line could not be read. |
| `BATCH_FILE_UNREADABLE`, `BATCH_FILE_EMPTY`, `BATCH_FILE_INVALID` | The list of part numbers is missing, empty, or holds a line that is not a part number. |
| `PROMPT_NOT_FOUND`, `PROMPT_EMPTY` | No prompt file for that version, or one with nothing in it. |

## Testing

No test calls the API. `test/helpers/agent-sdk.ts` builds the messages a real
run would produce and a `scriptedQuery` that emits them; a test that wants to
show what the agent did calls the tools itself in `onStart`. The hook is
tested through the options the runner passed, which is the only way to prove
the gate a run was actually given is the run's own.
