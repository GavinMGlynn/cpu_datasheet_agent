# classify

Categorisation rules: pure functions from extracted parameters to the fixed
classification axes (Module 11). Import from `src/classify/index.ts`.

Every rule is a named, versioned function with no I/O, so the same parameters
always produce the same axes and a stored classification says which rule
produced it.

## `classify(parameters)` and `tryClassify(parameters)`

`classify` returns every axis or throws `ClassifyError` `CLASSIFY_INCOMPLETE`,
which names each axis it could not decide, the parameters that axis needed,
and the reason. There is no partial answer: a caller that wants what could be
decided asks `tryClassify`, which returns `{ classifications, undecided }`.

The input is a *partial* parameter set. Classification runs on whatever
extraction has produced, and a parameter that is present but `null` is not
missing — `null` is a value the datasheet stated (an adjustable part's fixed
output), and the rules read it as one.

Every classification is validated before it is returned, so a rule producing a
value outside its axis fails loudly rather than being stored.

## The rules

| Axis | Rule | Reads | Decides |
| --- | --- | --- | --- |
| `vinClass` | `vin-class.v1` | `vinMax` | `le_5v5` ≤ 5.5 V, `le_18v`, `le_42v`, `le_60v`, else `gt_60v` |
| `ioutClass` | `iout-class.v1` | `ioutMax` | `le_1a` ≤ 1 A, `le_3a`, `le_6a`, `le_12a`, else `gt_12a` |
| `topology` | `topology.v1` | `topology` | the parameter unchanged |
| `integration` | `integration.v1` | `integration` | the parameter unchanged |
| `outputType` | `output-type.v1` | `voutFixed` | `adjustable` when null, else `fixed` |
| `packageFamily` | `package-family.v1` | `package` | the shape family, or undecided |
| `temperatureGrade` | `temperature-grade.v1` | `operatingTempMin`, `operatingTempMax`, `aecQ100` | `automotive`, `extended`, `industrial`, `commercial`, or undecided |
| `features` | `features.v1` | `enablePin`, `powerGoodPin`, `softStart`, `externalSync`, `lightLoadMode` | the features present, in vocabulary order |

**A temperature grade is the widest envelope the part's range covers
completely** — extended −40 to 125 °C, industrial −40 to 85 °C, commercial
0 to 70 °C — so a 0 to 125 °C part is commercial: it does not reach
industrial's −40 °C, and claiming that it does is the error that matters. A
range covering none of them is undecided rather than forced into the nearest.
`aecQ100` makes a part automotive whatever its range.

The grade describes the operating range as stated, whichever temperature it
is referenced to. Almost every regulator states a junction range and almost
every grade convention means ambient, so the distinction is kept where it can
be read — `temperatureReference` on the parameter — rather than folded into a
word that cannot carry it.

**A light-load mode of `pfm`, `psm` or `selectable` is a light-load feature**;
`forced_pwm` and `none` are not.

## Package shapes (`package-shape.ts`)

`parsePackage(text)` reads a package description — a datasheet's, Digi-Key's
`Package / Case`, a `Supplier Device Package` — into `{ text, family, pins }`.

- **A width settles a text that names two families.** `8-TSSOP, 8-MSOP
  (0.118", 3.00mm Width)` names both; the width says which, and Digi-Key's own
  supplier field calls those listings MSOP. 3.00 mm is MSOP, 4.40 mm TSSOP,
  3.90 mm SOIC — the three the corpus shows.
- **Otherwise every matching name is collected, and two disagreeing families
  decide nothing.** `6-TSSOP, SC-88, SOT-363` names a TSSOP and a 6-lead
  SC-70, so it yields no family at all.
- `MLF` and `TMLF` have no rule: the brand covers both QFN and DFN parts, so
  it names no shape on its own.
- **`other` is a decision and `null` is the absence of one.** A BGA is a shape
  outside the vocabulary; `Cylinder, Threaded` is a text nothing can be read
  from. Collapsing the two would let a BGA and a cylinder agree.
- Lead count comes from an explicit `12 Leads` first, then a leading `16-`,
  then the count inside a SOT-23 name, then a trailing `-8` after a family
  name. `SOT`, `SC` and similar names are excluded from the last rule, because
  `SOT-223` is not a 223-lead package.

## Tests

`test/classify/package-corpus.test.ts` runs the parser over Digi-Key's two
package fields for all 746 recorded parts. Where both name a family they are
an independent check on each other: 547 pairs are comparable and 543 agree.
The nine that do not are Digi-Key's own fields disagreeing — `Package / Case`
says DFN where `Supplier Device Package` says QFN — and are listed there by
part number, uncorrected, because a distributor field is recorded as it was
published. One pin count disagrees, and both readings are true: a 16-lead MSOP
body with 12 leads fitted.

Every family but `to220`, `to263` and `sot223` appears in the corpus; the
recorded parts are all surface-mount switching regulators, so those three rest
on hand-written cases alone.
