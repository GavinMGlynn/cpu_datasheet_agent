# test/fixtures

Recorded API responses, used to test the adapters that parse them.

## What is here

| Directory  | What it holds                                                                              |
| ---------- | ------------------------------------------------------------------------------------------ |
| `digikey/` | Product detail, pricing, media, packaging and keyword-search responses for fifteen part numbers. |
| `mouser/`  | Part-number and keyword search responses for the same parts.                                 |
| `mpn/`     | 746 part numbers with the package, packaging and temperature fields the MPN decoders are checked against — manufacturer specifications, read through a keyword search. |

`scripts/record-fixture.ts` and `scripts/record-mpn-corpus.ts` record them, and
`src/adapters/digikey/fixtures.ts` sanitises each one on the way in. They are
recorded rarely and deliberately: every recording spends live API quota.

## Why they are real responses

The adapters exist to survive what a distributor actually sends — nulls where
the documentation promises a string, a price break list in an unexpected
order, a packaging value nobody wrote down. A fixture invented to match the
parser proves only that the parser matches itself. `test/live/*.test.ts` runs
the same assertions against the live APIs on demand, and these files are what
it compares against: the day a response shape changes, the difference between
the two is the alarm.

## What they are not

- **No credentials.** Nothing that identifies the account, the key or the
  token is ever written; `sanitiseFixture` strips it and a test asserts that.
- **Not a database.** Fifteen parts in full and a list of part numbers,
  recorded once, kept for parsing tests. This project is not a price
  aggregator and holds no bulk catalogue: anything downloaded in anger lives
  in `cache/`, which is git-ignored and never published.
- **Not current.** Prices and stock are a snapshot from the day they were
  recorded and should not be read as either.

The product data in these files belongs to Digi-Key and Mouser, and the part
numbers and specifications to the manufacturers. They are included as the
smallest excerpt that makes an open-source client testable (R-01, R-03). Any
of them will be removed on request from the party whose data it is.
