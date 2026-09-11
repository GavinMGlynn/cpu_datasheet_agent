# reconcile

Compares extracted parameters with distributor parametrics, records what
disagrees, and escalates what must not be decided by a rule (Module 11).
Import from `src/reconcile/index.ts`.

## `reconcile({ mpn, parameters, sources }, { now, newId })`

`sources` is one entry per distributor: its `DistributorProvenance` and the
`DistributorFact`s the adapter produced. The result is:

| Field | Meaning |
| --- | --- |
| `parameters` | One entry per parameter either side stated, in schema order, with its outcome, its observations, and a verdict for each comparison made. |
| `updated` | The input parameters with conflicts recorded and confidence set to `conflict`. Values are never changed. |
| `escalations` | One validated `Escalation` per conflicting safety parameter. |

Outcomes are `agree`, `conflict`, `datasheet_only` and `distributor_only`.

**`null` means the datasheet did not state the parameter**, so a distributor
fact about it is `distributor_only` rather than a conflict. The exception is
`voutFixed`, where `null` is the statement that the part is adjustable, and it
is compared as one.

**An observation nobody could compare corroborates nothing.** A package text
naming no family leaves the parameter `datasheet_only` with the observation
recorded and its verdict `incomparable`, not `agree`.

**Nothing is adopted from a distributor.** A `distributor_only` fact is
reported for the agent to act on, never written into the parameter set: a
value with no page behind it is not an extracted value.

## Conflicts

A conflict keeps the datasheet's value and records the distributor's beside it
on the parameter, with the id of the rule that judged them to disagree. The
parameter's confidence becomes `conflict`, which by the `Part` schema puts the
part out of `verified` and into `needs_human` or `rejected`.

A conflict on a **safety parameter** — `vinMax`, `vinAbsMax`, `ioutMax`,
`operatingTempMin`, `operatingTempMax`, `rdsOnHigh`, `rdsOnLow` — additionally
raises an `Escalation` of kind `conflict`, carrying the question, both
readings as options, and the cited page when there is one. These are never
resolved by a rule: a wrong absolute maximum is a dead board.

One escalation is raised per parameter, however many distributors disagree.

## Comparison (`compare.ts`)

`compareObservation(key, value, observed, policy)` returns `agree`,
`conflict` or `incomparable` with the rule id and both readings.

| Stored | Distributor | Rule |
| --- | --- | --- |
| quantity | quantity | equal within the parameter's tolerance |
| quantity | `max` / `min` | a bound is a limit, not a value: agreeing means not exceeding it |
| quantity | range | the value lies inside the range |
| range | quantity | the value lies inside the range |
| range | range | both ends equal within tolerance |
| range | `max` / `min` | the end the bound speaks about |
| boolean | boolean | equality |
| soft start | boolean | whether the part has it |
| enum | enum | equality |
| `voutFixed` | `fixed` / `adjustable` / a voltage | null is adjustable |
| `package` | text | shape family and lead count, never words |

A pairing that cannot be compared at all — a boolean against a voltage —
throws `ReconcileError` `RECONCILE_SHAPE_MISMATCH`. That means the mapping
table produced a fact of the wrong kind for the parameter, which is a defect
in the table rather than an unusual part. A fact whose unit is not the
parameter's raises `UnitMismatchError` from `src/units/`.

**Packages are compared as shapes.** `8-PowerSOIC (0.154", 3.90mm Width)` and
`8-SOIC PowerPAD (DDA)` are one package written two ways, so text equality
would report a conflict on nearly every part. Lead counts are compared only
where both sides state one.

## Policy (`policy.ts`)

`PARAMETER_POLICIES` holds, for all thirty parameters, the tolerance, whether
a conflict escalates, how several observations combine, and **why the
tolerance is what it is**. The tolerances are first estimates taken from what
the recorded fixtures show distributors doing, and Module 13's
hand-characterised parts are where they get calibrated.

Two entries carry most of the judgement:

- `voutMax` allows ten percent. Digi-Key publishes a duty-cycle-limited
  maximum (17.28 V against an 18 V input) where a datasheet states the
  regulation range, so the two differ by several percent without disagreeing.
- `package` corroborates with `any` rather than `all`: Digi-Key states the
  package twice and its own two fields disagree on 9 of 547 recorded parts, so
  one field agreeing settles it. Every other parameter uses `all`, where one
  distributor disagreeing is a conflict even if another agrees — two
  distributors are two readings of the same part, not two descriptions of one
  thing.

Temperatures are compared exactly: grades are whole degrees, so any difference
is a real one, most often a junction range against an ambient one.

## What is not compared

Neither distributor publishes an absolute maximum input voltage, on-resistance
or a quiescent current for the parts recorded so far, so those parameters are
`datasheet_only` in practice. The topology, output type, temperature range,
package and the main voltages and currents are what actually get a second
opinion.
