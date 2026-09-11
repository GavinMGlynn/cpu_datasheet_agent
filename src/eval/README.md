# eval

The golden set and the scorer: what the agent's output is measured against,
and how (Module 13). Import from `src/eval/index.ts`.

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
