# mpn

MPN normalisation, suffix decoding, candidate gathering, matching, and family
detection (Module 10). Import from `src/mpn/index.ts`.

The rule this module exists to keep: **an unreadable suffix decodes to null,
never to a partial answer.** A half-read part number is a confident wrong
answer about package or temperature grade, and every value downstream
inherits it.

## Normalisation (`normalise.ts`)

`normaliseMpn(raw)` returns `{ raw, mpn, removed }`. It uppercases, removes
whitespace entirely (the canonical form holds none, so a part number split
across a line break in a table is the same part number), and strips
distributor decoration in the two shapes both distributors use: a numeric
vendor prefix (`296-`, `595-`) and Digi-Key's `-ND` with its packaging code
(`CT`, `TR`, `DKR`). Every removal is listed in `removed` as `reason:text`, so
a wrong strip is visible rather than silent. A vendor prefix is only removed
when a letter follows it, which leaves stock numbers such as `1276-1002-1-ND`
alone instead of inventing a part number from one.

Errors are `MpnError`: `MPN_EMPTY`, `MPN_TOO_LONG` (past the 64 characters the
schema allows), `MPN_INVALID` (characters no part number uses).
`isNormalisedMpn(text)` answers whether text is already canonical.

## Decoding (`grammar.ts`, `decoders/`)

A decoder is a declarative specification compiled into one anchored pattern:

```ts
compileDecoder({
  manufacturer: 'texas-instruments',
  names: [/^texas\s+instruments$/i],
  forms: [{ packages: TI_PACKAGES, packagings: [...], segments: [...] }],
});
```

Segments are `base`, `package`, `grade`, `packaging`, `leadFinish`, `literal`
(a fixed string that may mean automotive, a lead finish or a packaging), and
`option` (recognised free text). The pattern is built from the same tables the
decode reads, so the two cannot drift; a code the pattern matches is a code
the table holds, and `MPN_TABLE_MISSING` is thrown if that ever stops being
true. A form with a table segment and no table refuses to compile.

`decode` returns a `DecodedMpn` or null:

| Field | Meaning |
| --- | --- |
| `family` | The part number with every suffix removed. One datasheet usually covers one family. |
| `basePart` | The family plus every code that changes which part you receive, joined with hyphens (`LMR33620-C-5`). A comparison key, not an orderable number. |
| `package` | `{ code, family, description, pins }`, where `family` and `pins` are null when the code does not decide them. |
| `temperatureGrade` | `{ code, range, guaranteed }`, both ranges null when the letter fixes neither. |
| `packaging` | What the part number says about how it ships, in the `Packaging` vocabulary. |
| `leadFinish`, `automotive`, `extras` | The finish, AEC-Q100 qualification, and recognised codes with no field of their own. |

**Options are identity by default.** A version letter, a fixed output voltage
or a configuration code joins `basePart`; only codes declared
`role: 'decoration'` (a value-added option, a wafer marker) go to `extras`. A
code nobody has explained is safer treated as a different part than as the
same one.

**Variant groups match lazily.** Read greedily they swallow the marker that
follows: the `Q` of `TPS5430QDDARQ1` becomes a version letter instead of the
automotive marker, and the `P` of `NCV890200PDR2G` leaves `D` behind, putting
an exposed-pad SOIC part in a plain SOIC.

### What each decoder claims

| Manufacturer | Reads | Does not claim |
| --- | --- | --- |
| Texas Instruments | Version and option codes, `Q`/`Q1` automotive, package, `R` (3,000-part reel) and `T` (250-part reel) [R-63]; a tube otherwise | Pin counts for `D`, `DBV`, `PWP` and `RHL`, which TI's own guide shows spanning several [R-62] |
| Analog Devices | Both schemes it inherited: Linear's variant, grade, package, fixed voltage, `#`, `TR`, `PBF`; Maxim's variant, grade, package, `+`, `T` | Nothing beyond the two families in the corpus |
| Monolithic Power Systems | Variant, package, option, `-AEC1` automotive, `-LF` lead-free, `-Z` and `-P` reels [R-65] | Pin counts, which vary by device for almost every code |
| Diodes Incorporated | Variant, `Q` automotive (AEC-Q100), package, `-7` and `-13` reels [R-66] | The `-N` and `CO5ZCW20` suffixes, which nothing explains |
| onsemi | Variant, package, fixed output voltage, reel code, `G` lead-free | Automotive from the `NCV` prefix: the corpus shows every `NCV` part rated to 150 °C, but a rating is not a qualification |
| Richtek | Variant, the `G`/`Z` code, package | A meaning for `G` or `Z`, and any packaging: Richtek encodes none |
| Microchip | Its own scheme (`T` reel, grade, `/package`, value-added option) and the Micrel scheme it acquired | A temperature range for any grade letter: Digi-Key reports grade `I` as both -40…125 °C junction and -40…85 °C ambient |
| STMicroelectronics | `ST1S` and `ST1PS` package codes, and `TR` for tape and reel | A package for the `L` series, whose variant letters are part of the device name (`L7987` and `L7987L` are different regulators) |

**`packaging` is what the part number states, not where a distributor stocks
it.** Both are true of different things: `AP62400WU-7` says a 7-inch reel and
Digi-Key ships it in bulk. `Offer.packaging` is the distributor's answer.

**A temperature grade's `range` and `guaranteed` differ.** An Analog Devices
E-grade part operates from -40 °C but is only specified from 0 °C, with the
rest assured by design; an I-grade part is tested across the whole range
[R-64]. Both report -40…125 °C to a distributor. A -40 °C design wants the I.

## Candidates (`candidates.ts`)

`gatherCandidates(sources, query, { limit })` asks Digi-Key and Mouser for
every listing of a part number and decodes each one. Sources are structural,
so a test needs a search function and a currency rather than a client, a cache
and a token store; `DigiKeyApi` and `MouserApi` satisfy them as they are.

A distributor that fails is recorded in `failures` rather than thrown, so one
being down does not lose what the other found; a listing whose part number is
not one is recorded in `skipped`. When every distributor asked failed and
nothing came back, `MPN_LOOKUP_FAILED` is raised: no listings and no working
source is a broken lookup, not a part that does not exist.

## Matching (`match.ts`)

`relate(query, decoded, candidate)` returns:

- `exact` — the same part number.
- `packaging_variant` — same base part, package, grade and qualification;
  only the reel, finish or value-added codes differ.
- `sibling` — same family, but not those. A different part, however similar
  the number looks.
- `unrelated` — a different family, a different manufacturer, or either side
  undecoded. Nothing is claimed across manufacturers, because the same suffix
  means different things to each.

`resolveMpn(query, candidates, { now, newId })` returns the matches best-first
with the resolved listing, or a validated `ambiguous_mpn` `Escalation` when
the answer is not the agent's to make: two manufacturers listing the same part
number, or no exact listing and several siblings to choose between. A single
sibling is left unresolved rather than escalated or guessed at.

`decodeQuery` works out the manufacturer from the listings — an exact match
names it, otherwise every manufacturer among the candidates is tried — and
returns null if two decoders both read the number.

## Family detection (`family.ts`)

`linkDatasheetFamily(deps, ref, reference)` finds the ordering-information
pages with `findPages`, reads them, and links every part number of the
reference part's family to the datasheet digest with `linkMpn`. One datasheet
commonly covers a whole family, so recording the whole list is what makes the
next lookup of a sibling find the document already on disk.

`orderingMpnsFrom(pages, reference)` is the pure half: it scans for tokens in
the part-number alphabet, decodes each with the reference part's own decoder,
and keeps those in the same family. That is what keeps a competitor's part
number, a package drawing code and a document number out of the list — and it
is where a decoder returning null for an unreadable suffix earns its keep.

## Tests

`decoders.test.ts` holds hand-checked cases per manufacturer.
`test/mpn/corpus.test.ts` runs every decoder against 570-odd real part numbers
recorded live from Digi-Key (`scripts/record-mpn-corpus.ts`), checking each
claimed package family, pin count and temperature range against Digi-Key's own
fields — an independent source rather than a restatement of the tables. Part
numbers no decoder reads are listed there by name with the reason.
