# units

Engineering-notation parsing, normalisation, formatting, comparison, and
distributor parametric mapping (Module 5). Pure functions, no I/O. Import
from `src/units/index.ts`.

## Normalisation (`normalise.ts`)

`normaliseText` applies NFC, turns unicode minus and exotic spaces into their
plain forms, collapses whitespace, joins a sign to its digits (`- 40` to
`-40`), removes thousands separators of the form `1,500`, and joins split
unit spellings (`deg C`, `° C`, `V DC`). `stripToleranceSign` removes a
leading `±`, `+/-`, or `+-`; `expandShorthand` rewrites `3V3` as `3.3V` (volts
and amps only).

## Units (`unit-table.ts`)

`resolveUnit(token)` maps a unit token to a canonical unit and a prefix
exponent: aliases are matched case-insensitively (`V`, `volts`, `Vdc`, `A`,
`amps`, `Hz`, `s`, `sec`, `Ohm`, `Ω`, `W`, `°C`, `℃`, `degC`, `C`, `%`,
`percent`), prefixes are case-sensitive except kilo (`p n µ μ u m k K M G`).
`degC`, `percent`, and `count` never take a prefix. Because aliases are
case-insensitive, `mS` resolves to milliseconds; siemens is not a supported
unit. `UNIT_SYMBOLS` gives the display symbol for each unit, and
`siPrefix(exponent)` the prefix for a power of ten (a multiple of three
between `MIN_PREFIX_EXPONENT` and `MAX_PREFIX_EXPONENT`, throwing
`UnitRangeError` otherwise so a formatter that miscomputes its exponent fails
loudly).

## Parsing (`parse.ts`)

- `parseQuantity(text, expectedUnit)` accepts a single value with the
  expected unit, in any alias or prefix form, including `3V3`, `±2%`,
  `- 40 C`, `1,500 kHz`, and scientific notation. A range, a missing unit
  (unless `count` is expected), another unit, or trailing text is rejected.
  Numbers are built from their decimal text and the prefix exponent
  (`scaleDecimal`), so `70 µA` is exactly `0.00007`.
- `parseRange(text, expectedUnit)` accepts `min to max` with separators
  `to`, `~`, `…`, `...`, en or em dash, `/`, or a hyphen between two values
  (an exponent's sign is never treated as a separator). A unit on one side
  applies to both. A single value is never promoted to a range; a reversed
  range is rejected.
- `parseTemperatureRange(text)` also extracts a `TJ`/`TA` (or
  `junction`/`ambient`) marker as the reference, or `null`.
- Every parser throws `ParseError` (`UNIT_PARSE_FAILED`) with the text and
  reason in `details` and never returns `NaN`. `tryParse*` variants return
  `{ ok, value | error }` and rethrow anything that is not a `ParseError`.

## Formatting (`format.ts`)

`formatQuantity` and `formatRange` produce canonical text (shortest exact
decimal, unit symbol, no prefix) that round-trips through the parsers
exactly; a property test proves it for every unit. `formatEngineering` is
display-only: engineering notation with a prefix and a chosen number of
significant digits.

## Comparison (`compare.ts`)

`compareQuantities(a, b, { relative?, absolute? })` returns `equal`,
`a_greater`, or `b_greater` with the difference, relative difference, and the
allowance applied (the larger of the absolute allowance and the relative
allowance times the larger magnitude). Different units throw
`UnitMismatchError` (`UNIT_MISMATCH`).

## Distributor mapping (`distributor-map.ts`)

`digikeyParameterToKey(name)` and `mouserAttributeToKey(name)` return a
`DistributorMapping` (`keys`, `kind`, optional `unit`) or `null` for names
that carry no schema parameter. Lookup ignores case and spacing.
`parseDistributorValue(mapping, text)` turns an attribute value into
`DistributorFact`s keyed by parameter (`quantity`, `range`, `enum`,
`boolean`, or `text`); `-`, blank, and `N/A` yield none. Kinds: plain
quantities, quantity-or-range (switching frequency), output voltage (fixed
value, or a range plus `voutFixed: adjustable`), temperature range with an
optional reference, `Synchronous Rectifier` yes/no to topology, `Output
Type` to `voutFixed` fixed/adjustable, and `Control Features` to the feature
booleans it names. A fact is an `ObservedValue` from `src/core/` plus its
parameter key, so a value that later disagrees with the datasheet is stored on
the parameter exactly as it was observed. Provenance is attached by the
adapters.

**A control feature the list does not name yields no fact.** Recording `false`
would assert that the part lacks it, and the field is a short description
rather than an inventory; none of the 13 recorded Digi-Key regulators carries
the field at all, so there is no evidence it is exhaustive. This is D24's rule
(an inconclusive value yields no fact) applied to absence.

The name tables hold the parametric names known at the time of writing.
Modules 7 and 8 must extend them from recorded fixtures and re-run these
tests; that reopens task 5.7 until every fixture name is mapped or listed as
carrying no parameter.
