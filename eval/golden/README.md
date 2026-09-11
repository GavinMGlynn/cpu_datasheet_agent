# eval/golden

Twenty-two buck regulators characterised by reading their datasheets, one
JSON file per part, validated against the core schemas. Nothing the agent
produces is trusted until it is measured against these (Module 13).

## What a file holds

A `GoldenPart`: the part number and manufacturer, why it is in the set, the
datasheet it was read from, every parameter with the page it came from, the
classification axes derived by hand, what the part number itself should
decode to, and a note for every value that is null or that needed a judgement
call.

**Every value carries a page, including the null ones.** "The datasheet does
not state this" is a fact about a page too, and the note says what the page
says instead — an equation, a curve, a figure for a different orderable.

## Who read them, and what that is worth

The readings were made by Claude (Opus 5) working page by page through each
datasheet: section map, then the ratings and electrical tables as text, and
the rendered page where text extraction mangles a table. `readBy` on every
file records that.

This matters for what the set can prove. Measuring an automated extraction
against a careful reading by the same model family is weaker than measuring
it against an independent human reading: a misreading that comes from how the
model reads would appear in both, and the eval would call it correct. The set
is still worth having — it catches regressions, gross errors, and every value
the pipeline simply fails to find — but a human pass over these files is what
would make it a reference rather than a baseline. That is open question Q6 in
`docs/PROJECT_PLAN.md`.

One thing the method already caught: text extraction of the TPS62130
electrical table interleaves the high- and low-side on-resistance rows, so
the text says 40 mΩ where the datasheet says 90 mΩ. Reading the rendered page
is what found it, and 23 values across the set carry `method: "image"` for
that reason.

## The parts

| Part | Manufacturer | Vin max | Iout | Package | Datasheet |
| --- | --- | --- | --- | --- | --- |
| `AP62200WU-7` | Diodes | 18 V | 2 A | sot23 | `4cfe71e0` |
| `AP62201WU-7` | Diodes | 18 V | 2 A | sot23 | `4cfe71e0` |
| `AP63203WU-7` | Diodes | 32 V | 2 A | sot23 | `ef99daa3` |
| `AP63205WU-7` | Diodes | 32 V | 2 A | sot23 | `ef99daa3` |
| `AP63357DV-7` | Diodes | 32 V | 3.5 A | dfn | `82b3f784` |
| `IR3899MTRPBF` | Infineon | 21 V | 9 A | qfn | `08fe759e` |
| `MCP16331T-E/CH` | Microchip | 50 V | 0.5 A | sot23 | `bfd74d5f` |
| `LM2596S-3.3/NOPB` | Texas Instruments | 40 V | 3 A | to263 | `2eec9087` |
| `LM5116MH/NOPB` | Texas Instruments | 100 V | controller | tssop | `5341823d` |
| `LM5164DDAR` | Texas Instruments | 100 V | 1 A | soic | `cce03619` |
| `LM5164QDDARQ1` | Texas Instruments | 100 V | 1 A | soic | `ee02bec8` |
| `LM76002RNPR` | Texas Instruments | 60 V | 2.5 A | qfn | `1ef4ab64` |
| `LM76003RNPR` | Texas Instruments | 60 V | 3.5 A | qfn | `1ef4ab64` |
| `LMR33630ADDAR` | Texas Instruments | 36 V | 3 A | soic | `3b0920a4` |
| `TLV62569DBVR` | Texas Instruments | 5.5 V | 2 A | sot23 | `1ba6f55d` |
| `TPS54331DDAR` | Texas Instruments | 28 V | 3 A | soic | `cf72dfd0` |
| `TPS54331DR` | Texas Instruments | 28 V | 3 A | soic | `cf72dfd0` |
| `TPS54560BDDAR` | Texas Instruments | 60 V | 5 A | soic | `a941117b` |
| `TPS54620RHLR` | Texas Instruments | 17 V | 6 A | qfn | `3fa567fe` |
| `TPS562200DDCR` | Texas Instruments | 17 V | 2 A | sot23 | `ec98a636` |
| `TPS563200DDCR` | Texas Instruments | 17 V | 3 A | sot23 | `ec98a636` |
| `TPS62130RGTR` | Texas Instruments | 17 V | 3 A | qfn | `f9b1af28` |

The set also holds one part specified the old way. TI's LM2596, from 1999,
gives its switch a saturation voltage rather than an on-resistance, runs at a
fixed 150 kHz, reaches 100% duty cycle, and cools through a TO-263 tab. Every
one of those is a shape the schema has to accept without inventing a number
for the shape it expected.

Six datasheets cover more than one part in the set. That is the case the
project exists for: "the datasheet for this part number" is usually a lie,
and an extraction has to tell `TPS562200DDCR` from `TPS563200DDCR`, or
`AP63203WU-7` from `AP63205WU-7`, from the part number and the ordering
table rather than from the document.

## What it covers

- **Input voltage**: every class, 5.5 V to 100 V.
- **Output current**: 0.5 A to 9 A, plus one controller that states none.
- **Topology**: synchronous and non-synchronous.
- **Integration**: integrated-FET converters and one controller (LM5116).
- **Output**: adjustable, and three fixed parts (3.3 V, 3.3 V and 5 V) —
  three because a parameter only two parts state is measured on a sample of
  two, which `chip-eval health` refuses to call a measurement.
- **Package**: SOT-23, SOIC, QFN, DFN, TSSOP, TO-263.
- **Temperature grade**: commercial through automotive, with two AEC-Q100
  parts (MCP16331 and LM5164-Q1).

## Two deviations from the plan, and why

**Four manufacturers, not six.** The set can only hold parts whose datasheets
can be fetched without scraping or working around a bot wall, which
`CLAUDE.md` forbids. Texas Instruments, Diodes, Microchip and Infineon serve
PDFs to a plain HTTP client. Monolithic Power Systems returns an HTML viewer
for every document URL; ST, onsemi and Analog Devices refuse or redirect the
request. Rohm serves PDFs from its CDN but not through the referral link
Digi-Key publishes. Those parts are reachable by hand in a browser, and can
be added the same way if the user supplies the files.

**Digi-Key's own datasheet link is not always the datasheet.** For every TI
part it is an interstitial HTML page whose `gotoUrl` parameter holds the real
document, sometimes encoded twice; the adapter unwraps it (D45). For
`LT8610AEMSE-PBF` it points at the LTpowerCAD help file rather than the
part's datasheet, which is why no Analog Devices part is here.

## Adding a part

1. `npx tsx scripts/prepare-golden.ts <MPN>` fetches the datasheet through
   the cache, records its digest and page count, finds the sections and
   writes the pages worth reading to `eval/golden/work/<MPN>.md`. Add
   `--render <page>` for a table that text extraction mangles, `--find
   "<regex>"` to locate a phrase, and `--url` when the distributor's link is
   not the document.
2. Read it, and write `eval/golden/<MPN>.json` in the same shape as the
   files here. Every value needs a page; every null needs a note.
3. `npx vitest run test/eval` validates the file, checks every citation
   against the page count, and compares the hand-derived classifications
   with what the rules produce.

The working files under `work/` are the manufacturers' copyright and are
gitignored, as the PDFs themselves are (D08). What is committed is the values
and the page each came from.
