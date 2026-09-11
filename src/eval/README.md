# eval

The golden set, the scorer, and the harness that runs one against the other
(Modules 13 and 16). Import from `src/eval/index.ts`.

## Running an evaluation

```
npx tsx bin/chip-eval.ts run [--parts A,B] [--model <id>] [--max-cost <usd>]
npx tsx bin/chip-eval.ts compare eval/results/<a> eval/results/<b>
npx tsx bin/chip-eval.ts replay <run id>
npx tsx bin/chip-eval.ts health [--dir eval/golden]
```

`runEval` takes each golden part through a real extraction run and scores what
it stored. Two rules make the number mean something:

- **Every run is a no-spend run.** The distributors and the datasheets come
  from the cache, so an evaluation costs model calls and nothing else and can
  be repeated next week. A part whose run had to ask for something uncached is
  reported as **starved** rather than scored quietly — its score would measure
  the cache rather than the prompt. `scripts/warm-eval-cache.ts` fills the
  cache first, through the same tools, so the keys are the ones the agent
  looks under.
- **Every run gets a database of its own.** The tool surface includes
  `get_part`, and a run that can read the answer out of an earlier run's work
  is not measuring extraction.

A part the run failed to store scores as a part that stated nothing: no
credit, and the reason is in its run record.

## Reports, comparison and replay

`writeReport` writes `result.json` and `summary.md` under
`eval/results/<timestamp>-<prompt version>-<model>/`. The report states the
prompt version, the model and the effort, because a score without them is a
number about nothing.

`compareReports(a, b)` diffs two of them parameter by parameter and flags a
**regression**: a value that scored worse, or one whose citation did. A value
that stays right while its page drifts is still a change for the worse, and
the citation is half of what this project promises. Parts only one run covered
are listed rather than counted.

`replayRun(ledgerDir, id)` rebuilds a run from the ledger — what it was asked,
every tool call, what each returned, with oversized outputs read back out of
the blob store. The id is the one in the `runs` table or the ledger's own.

## Health

`checkGoldenHealth(golden)` is the check on the measurement rather than on the
extraction: no part counted twice, and no parameter with fewer than three
parts stating it. A parameter two parts state is a coin toss — one lucky
reading looks like a capability. It is why the set has three fixed-output
parts rather than two.

## The golden set

`GoldenPart` is one part read by hand: parameters with page-level provenance,
the classification axes derived from them, what the part number should decode
to, and a note for every value that is null or needed a judgement call.
`loadGoldenSet()` reads and validates every file in `eval/golden/`; a file
that fails validation throws rather than being skipped, because a golden set
with an unreadable member measures the wrong thing quietly.

`eval/golden/README.md` lists the parts, what they cover, and who read them —
including what that last point is worth.

## The scorer

`scorePart(golden, extracted)` scores one extraction against one golden part,
per parameter:

| Score | Meaning |
| --- | --- |
| `correct` | Both state it, and they agree. |
| `wrong` | Both state it, and they do not. |
| `missing` | The golden set states it and the extraction does not. |
| `extra` | The golden set holds null and the extraction states a value. |
| `absent` | Both agree there is nothing to state. Counts for neither precision nor recall. |

**`extra` is the expensive one**: a value invented where the datasheet says
nothing. It is scored separately from `wrong` so that an extraction that
guesses cannot hide behind an extraction that misreads.

Numbers are compared with the per-parameter tolerance from `src/reconcile/`,
the same one reconciliation uses, so "correct" means one thing in both
places. Everything else is exact: an enum, a boolean or a package string is
what the datasheet says or it is not.

Citations are scored separately from values, with `within_one` reported apart
from `exact`: a value read off the right table but attributed to the facing
page is a different kind of mistake from one attributed to nowhere near it.

`scoreSet(scores)` totals a run and reports precision, recall, provenance
accuracy and the per-parameter breakdown — which is what says whether the
extraction is weak everywhere or weak at one thing.
