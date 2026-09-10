# adapters/mouser

Mouser Search API v1: a second opinion on price and availability. Import from
`src/adapters/mouser/index.ts`.

Verified against the live API on **2026-09-10** with a Search API key.

## What Mouser is and is not good for

| Contributes | Does not contribute |
| --- | --- |
| Price breaks, stock, minimum order quantity, lead time | Electrical parametrics |
| Sibling part numbers (other packagings of the same part) | A datasheet URL, usually |

Across all 13 recorded switching regulators the Search API returned exactly two
attribute names, `Packaging` and `Standard Pack Qty`, and one part in thirteen
carried a datasheet URL. **Parameters come from Digi-Key and the datasheet**;
treating Mouser as a parametric source would mean inventing data it does not
publish. `MAPPED_ATTRIBUTE_NAMES` is therefore empty, and every attribute name
is reported as unmapped so the list can grow from real data if that changes.

## Access

The Search API key is a **separate registration** from the Order, Cart, and
Order History keys, which are issued together on the same account page and
authorised separately. A key for those is rejected here.

## Endpoints

| Operation | Method and path |
| --- | --- |
| `searchPartNumber` | `POST /api/v1/search/partnumber`, body `{ SearchByPartRequest: { mouserPartNumber, partSearchOptions: 'Exact' } }` |
| `searchKeyword` | `POST /api/v1/search/keyword`, body `{ SearchByKeywordRequest: { keyword, records, startingRecord } }` |

The key travels as an `apiKey` **query parameter**, not a header, so it is
kept out of every error message and detail object.

## Two behaviours that shape the client

**A rejected request still returns HTTP 200.** Failures arrive as an `Errors`
array in the body, so the status code alone never means success. Every
response passes through `assertNoApiErrors` before it is used, and a rejected
response is never cached.

**Numbers arrive as strings, prices as formatted text.** `Min`, `Mult`, and
`AvailabilityInStock` are strings; a price is `"$1.62"` with `Currency`
alongside. `parsePrice` handles both separator conventions and throws rather
than dropping a break it cannot read, because a missing break silently changes
the price curve.

## Modelling differences from Digi-Key

- Digi-Key lists **one SKU per packaging**; Mouser lists **one SKU per part**
  and names the packagings it offers as attributes. When a listing offers
  several, `listingPackaging` records `unknown`, because naming one would
  assert something the listing does not say.
- Prices come back in the **account's currency**, which is not necessarily the
  currency Digi-Key was asked for. This account returns USD while Digi-Key is
  configured for AUD, so any comparison must filter by currency rather than
  assume one. `selectBestPrice` already does.
- `AlternatePackagings` gives sibling part numbers, useful for MPN resolution
  in Module 10. Mouser returns them with leading whitespace on all but the
  first, so they are trimmed and de-duplicated.

## Errors

`MouserError` with `MOUSER_KEY_MISSING`, `MOUSER_REQUEST_FAILED`,
`MOUSER_API_ERROR`, `MOUSER_RATE_LIMITED`, `MOUSER_RESPONSE_INVALID`, and
`MOUSER_NOT_FOUND`. The last is a fact about the part rather than a failure of
the call.

## Fixtures

14 parts recorded (13 listed, 1 not) plus a keyword search, in
`test/fixtures/mouser/`, sanitised of account fields:

```bash
npx tsx scripts/record-fixture.ts mouser TPS54331DR AP63203WU-7
npx tsx scripts/record-fixture.ts mouser --keyword TPS54331
```

`test/live/mouser.test.ts` re-checks them against the real API under
`npm run test:live`, including an assertion that Mouser still publishes no
parametrics, so the day that changes is noticed.
