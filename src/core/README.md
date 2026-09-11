# core

Domain schemas and types (Module 1). Every boundary in the project parses with
these Zod schemas. All objects are strict: an unknown key is an error. Nothing
is coerced: a string where a number belongs is rejected, never parsed.

Import from `src/core/index.ts`. Each schema `X` is exported alongside its
inferred type `X`.

## Primitives (`primitives.ts`)

`RawMpn` (as given, trimmed), `NormalisedMpn` (uppercase, no whitespace),
`ManufacturerName`, `Sha256` (lowercase hex), `Iso8601` (UTC, ends in `Z`),
`Url` (http or https only), `PageNumber` (1-based integer), `Currency` (ISO
4217 subset in `CURRENCIES`), `Percent` (0 to 100), `Celsius` (above absolute
zero), `Distributor` (`digikey` | `mouser` | `nexar`).

## Quantities (`quantity.ts`)

- `Quantity` is `{ value: number, unit }` with `unit` from `UNITS`
  (`V A Hz s Ohm W degC percent count`). Every unit except `degC` must be
  non-negative; `percent` is capped at 100.
- `QuantityRange` is `{ unit, min, max, typ? }` with `min <= typ <= max`. A
  single value is never promoted to a range and a range is never collapsed to
  a value.
- `quantityOf(unit)` and `rangeOf(unit)` pin the unit, so a voltage field
  cannot hold amps.

## Provenance (`provenance.ts`)

Discriminated on `source`:

- `datasheet` — `sha256`, `page` (mandatory), `method` (`text` | `image`),
  optional `quote`.
- `distributor` — `distributor`, `sku`, `fetchedAt`, `cacheKey`.
- `human` — `note`, `recordedAt`.
- `derived` — `from` (one or more `ParameterKey`), `rule`.

## Parameters (`parameter.ts`, `parameter-keys.ts`, `buck-regulator.ts`)

`parameter(valueSchema)` wraps a value with `provenance` and `confidence`
(`extracted` | `verified` | `conflict`). `PARAMETER_KEYS` lists the thirty
buck-regulator parameters in schema order; a test keeps it equal to the keys
of `BuckRegulatorParameters`.

Nullable parameters (the datasheet may not state them): `voutFixed`,
`voutMax`, `feedbackReference`, `feedbackAccuracy`, `shutdownCurrent`,
`minOnTime`, `maxDutyCycle`, `efficiencyPeak`, `rdsOnHigh`, `rdsOnLow`.
`voutMax` is null where a datasheet gives the upper output limit as an
equation rather than a number, which TI's TPS54331 does. Everything else is
required and non-null. `switchingFrequency` is a fixed `Hz` quantity or an
`Hz` range.

A parameter may also carry `conflicts`: distributor values that disagree
with the one it holds, each an `ObservedValue` with the `DistributorProvenance`
it came from and the id of the comparison rule that judged them to disagree.
The key is absent when nothing disagreed and never an empty list. Module 11
writes it; `Part` requires any parameter carrying one to have confidence
`conflict`.

Cross-field invariants: `vinMin < vinMax <= vinAbsMax`; `voutMin <= voutMax`;
a non-null `voutFixed` equals both `voutMin` and `voutMax`;
`operatingTempMin < operatingTempMax`; a non-synchronous part has
`rdsOnLow: null`; a controller has both `rdsOn*` null; a part without soft
start has no soft-start time.

## Observations (`observation.ts`)

`ObservedValue` is a value as a distributor states it: `quantity`, `max`,
`min` (a stated bound rather than a value), `range`, `enum`, `boolean`, or
`text`. `DistributorFact` in `src/units/` is this shape plus the parameter
key, so a fact can be stored on a parameter without being reshaped.
`ParameterConflict` pairs one with its provenance and the rule that decided.

## Value shapes (`value-shapes.ts`)

`isQuantity`, `isRange` and `isSoftStart` tell which shape a parameter value
is, for code that reads values generically — rendering them, comparing them
with a distributor's. Structural rather than schema parses, because they run
on values that have already been validated.

## Records

- `Offer` — one distributor listing; price breaks strictly increasing in
  quantity; the embedded distributor provenance must name the same
  distributor and SKU.
- `Datasheet` — URL, digest, page count, local path, and the MPNs the ordering
  table covers (unique).
- `Classification` — discriminated on `axis`; each axis has a fixed value set
  (`VIN_CLASSES`, `IOUT_CLASSES`, `OUTPUT_TYPES`, `PACKAGE_FAMILIES`,
  `TEMPERATURE_GRADES`, `FEATURES`). `CLASSIFICATION_AXES` lists the axes.
- `Escalation` — a question for a person, with JSON `context`, optional
  `options` (at least two), and an optional `resolution` not earlier than
  `createdAt`.
- `Verification` — a verdict on one parameter against one page. `confirmed`
  and `contradicted` must quote; `not_found` must not. `VerificationClaim` is
  the same verdict before the run stamps itself on it: a reader states what it
  read and where, and when it read it and which prompt and model did the
  reading are facts about the run (D52).
- `Run` — one agent run over one part: kind, prompt version, model, and, once
  it has ended, the turns, the cost, the result and the details. Everything an
  ending brings arrives together or not at all, so a run that never came back
  is a row with no result rather than a half-filled one. `FinishedRun` is the
  same record with those fields no longer optional.
- `ToolCallRecord` — one ledger line with exactly one of `output` or `error`
  (`ErrorJson` matches `ChipAgentError.toJSON()`).

## Part (`part.ts`)

The aggregate `upsert_part` stores. Beyond the field schemas it enforces:

- a parameter citing a datasheet cites this part's datasheet (same digest) on
  a page it has; a part without a datasheet has no datasheet-cited parameter;
- `verified` status requires every parameter `verified`;
- a parameter carrying a distributor conflict has confidence `conflict`;
- any parameter in `conflict` forces `needs_human` or `rejected`;
- one classification per axis; one offer per distributor SKU;
- `updatedAt` is not before `createdAt`.

## Errors (`validation-error.ts`)

`parseOrThrow(schema, value, subject)` returns the parsed value or throws
`ValidationError` (`VALIDATION_FAILED`) whose `issues` carry the dot-joined
`path` (`(root)` for the whole value), the message, and the `received` value
at that path. `fromZodError` converts a Zod error the same way.

## Test fixtures

Builders for valid values live in `test/helpers/core-fixtures.ts`;
`expectAccepts` and `expectRejects` in `test/helpers/schema.ts` assert that
accepted values round-trip unchanged.
