# adapters/digikey

Digi-Key Product Information v4: the primary source of parametrics, pricing,
and datasheet URLs. Import from `src/adapters/digikey/index.ts`.

Everything here was verified against the live API on **2026-09-10** with a
production app. Where the API's behaviour differs from its documentation, the
observed behaviour is what is recorded below.

## Authentication (`token.ts`)

2-legged client credentials [R-60]. `POST` to
`https://api.digikey.com/v1/oauth2/token` (sandbox:
`https://sandbox-api.digikey.com/v1/oauth2/token`) with
`client_id`, `client_secret`, and `grant_type=client_credentials` as
`application/x-www-form-urlencoded`.

**The token lives 600 seconds.** That is shorter than a single extraction run,
so `DigiKeyTokenClient` refreshes 60 seconds ahead of expiry rather than
reacting to a 401. Concurrent callers share one in-flight request. The stored
token records a fingerprint of the client id, so a token issued for different
credentials is discarded rather than replayed.

`FileTokenStore` writes to `DATA_DIR/tokens/digikey.json` with mode `0600`;
`MemoryTokenStore` is the default.

Sandbox and production apps are **separate registrations** and each host
rejects the other's credentials with `401 Invalid clientId`. The config holds
both pairs and selects by `DIGIKEY_SANDBOX`.

## Endpoints (`digikey.ts`)

All below `/products/v4/search`. Verified live; the operation column is the
method on `DigiKeyApi`.

| Operation | Method and path | Notes |
| --- | --- | --- |
| `searchKeyword` | `POST /keyword` | Body `{ Keywords, Limit, Offset }`. Returns `Products`, `ExactMatches`, `ProductsCount`. |
| `productDetails` | `GET /{mpn}/productdetails` | The richest call: parametrics, packaging variants with pricing, and the datasheet URL. |
| `pricing` | `GET /{mpn}/pricing` | Returns the same variations as product details, so it is redundant for our purpose. |
| `media` | `GET /{mpn}/media` | Datasheets, photos, training modules. Only needed when the product has no `DatasheetUrl`. |
| `substitutions` | `GET /{mpn}/substitutions` | Manufacturer-suggested substitutes. |
| `alternatePackaging` | `GET /{mpn}/alternatepackaging` | Other part numbers for the same die in different packaging. |

Part numbers are percent-encoded into the path, because real ones contain `/`
and `#` (`LM2596S-5.0/NOPB`, `LT8610AEMSE#PBF`).

**Prefer `lookup(mpn)`.** Product details already carries pricing, parametrics
and the datasheet URL, so one request answers what would otherwise take three.
Media is consulted only when the product has no datasheet URL of its own.

## Request layer (`client.ts`)

Headers: `Authorization: Bearer`, `X-DIGIKEY-Client-Id`, and the three
`X-DIGIKEY-Locale-*` headers. The response echoes the locale it used, and
prices come back in the requested currency.

- Requests are **serialised with a minimum gap** (250 ms default) so a burst
  cannot trip the per-second limit.
- `401` refreshes the token once and retries. A second `401` surfaces.
- `408`, `429`, and `5xx` retry with exponential backoff, honouring
  `Retry-After` when the API sends it.
- `404` means Digi-Key does not list the part: `DIGIKEY_NOT_FOUND`, not a
  failure to report as an outage.
- The daily quota from `x-ratelimit-limit` and `x-ratelimit-remaining` is
  tracked on `client.rateLimit`. The observed limit is **1000 calls per day**.

## Response schemas (`schemas.ts`)

Objects are **loose**: Digi-Key adds fields over time and an unknown field is
not a reason to reject a response. Every field the adapter reads is declared,
so one that changes type does fail.

Two shapes that differ between endpoints, both found by validating against
live responses rather than by reading documentation:

- `AlternatePackagings` is an **object wrapping the array**
  (`{ AlternatePackaging: [...] }`), and its items are leaner than a product,
  with `Description` and `UnitPrice` as strings where product details uses an
  object and a number.
- `BaseProductNumber` is present on keyword-search results but sometimes
  without its `Name`, so the inner field is optional.

## Mapping (`map.ts`)

- `toOffers` produces **one offer per packaging variant**, each with its own
  Digi-Key SKU, stock, minimum order quantity and price breaks. Breaks are
  sorted and de-duplicated by quantity, and any below quantity one is dropped,
  because the core schema requires strictly increasing positive quantities.
  Marketplace listings are excluded unless asked for: they are not Digi-Key
  stock.
- Packaging names seen live: `Cut Tape (CT)`, `Tape & Reel (TR)`,
  `Digi-Reel®`, `Tube`. Digi-Reel is a paid re-reeling of cut tape and is
  recorded as a reel.
- `parametricFacts` maps the parametric block through the Module 5 tables. A
  name with no mapping is **reported, not dropped**, and a value that fails to
  parse is reported rather than guessed at.

Across the 13 recorded parts there are 16 distinct parametric names. The five
that carry no schema parameter are `Function`, `Output Configuration`,
`Topology`, `Number of Outputs`, and `Mounting Type`. Note that Digi-Key's
`Topology` means the converter family (`Buck`) rather than this project's
`topology`, which means synchronous versus non-synchronous and comes from
`Synchronous Rectifier`.

Three real values that drove changes in Module 5:

| Value | Meaning | Handling |
| --- | --- | --- |
| `Up to 1MHz` | An upper bound, not a value | A `max` fact, so nothing invents a lower end |
| `Both` (Synchronous Rectifier) | The part can run either way | No fact; the datasheet decides |
| `-` | Not applicable | No fact |

## Fixtures

`scripts/record-fixture.ts` records live responses with account-identifying
fields removed (`fixtures.ts`), into `test/fixtures/digikey/`. 13 parts across
6 manufacturers are recorded, plus a keyword search and one part Digi-Key does
not list. Unit tests never touch the network; `test/live/digikey.test.ts`
re-checks the fixtures against the real API under `npm run test:live`.

```bash
npx tsx scripts/record-fixture.ts TPS54331DR
npx tsx scripts/record-fixture.ts --ops productdetails LM5164DDAR
npx tsx scripts/record-fixture.ts --keyword TPS54331
```
