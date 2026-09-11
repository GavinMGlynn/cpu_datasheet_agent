# db

SQLite persistence (Module 4). Import from `src/db/index.ts`. Every write
validates with the core schemas first and rejects on any issue; nothing is
coerced. Every read re-validates, so a corrupted row surfaces as a
`ValidationError` rather than a silently wrong value.

## Connection and migrations

- `openDatabase(path, { busyTimeoutMs? })` opens a `Db` (WAL journaling for
  file databases, foreign keys on, busy timeout default 5 s) and applies
  `MIGRATIONS`. `:memory:` works for tests.
- `Db` exposes `raw` (the `better-sqlite3` handle), `transaction(fn)`,
  `immediateTransaction(fn)`, `pragma(name)`, and `close()`.
- `applyMigrations(db, migrations, clock?)` applies each pending migration in
  its own transaction and records it in `schema_migrations`; a failing
  migration rolls back completely. Ids must be consecutive from 1
  (`DB_MIGRATION_ORDER`); a database whose recorded migrations are not in the
  list is refused (`DB_MIGRATION_MISMATCH`). `appliedMigrations(db)` lists
  what is recorded. Migrations are TypeScript modules under `migrations/`
  holding SQL strings, listed in `migrations/index.ts`; append only.
- `requireRow(row, what)` unwraps a row that must exist (`DB_ROW_MISSING`).

## Schema (migrations 0001, 0002)

`datasheets`, `datasheet_mpns`, `parts`, `parameters` (one row per parameter
with the value as JSON plus `numeric_min`, `numeric_max`, and `unit` for
filtering), `offers`, `price_breaks`, `classifications`, `verifications`,
`escalations`, `nexar_budget` (single row, seeded with limit 90), and `runs`
(for the agent runner). Child rows cascade on part deletion.

Migration 0002 adds `parameters.conflicts_json`, holding the distributor
values that disagree with the stored one (Module 11). It is null when nothing
disagreed, and reads back as an absent key rather than a null one, because the
schema's optional annotation means "nothing disagreed" and a null would be an
unknown value.

## Repositories

`createRepositories(db)` returns one of each:

- `PartRepository` — `upsertPart(input)` validates the whole `Part`, then in
  one transaction upserts the part row and its datasheet and replaces every
  child row, so the stored part is exactly the aggregate given. `getPart`,
  `getPartId`, `listByStatus`, and `findParts({ category?, status?,
  classifications?, parameters?, limit? })`. Parameter filters compare the
  stored numeric bounds: `min` requires the value (or the whole range) to be
  at least `min`, `max` at most `max`; a `features` classification filter
  matches one feature in the set.
- `OfferRepository` — `replaceOffers(partId, distributor, offers)` replaces
  one distributor's listings atomically (`DB_OFFER_DISTRIBUTOR_MISMATCH` if
  an offer belongs elsewhere), `getOffers`, and
  `bestPriceAt(partId, quantity, currency)`, which applies the highest price
  break at or below the quantity on offers whose MOQ is met.
- `DatasheetRepository` — `record` (upsert by digest, replacing the covered
  MPN list, which round-trips in insertion order), `getBySha`, `linkMpn`
  (`DB_DATASHEET_NOT_FOUND`), `mpnsCoveredBy`, `findByMpn`.
- `VerificationRepository` — `record(mpn, verification)` appends
  (`DB_PART_NOT_FOUND`), `list`, `latestByParameter`.
- `EscalationRepository` — `create` (`DB_DUPLICATE_ESCALATION`), `get`,
  `list({ mpn?, kind?, resolved? })`, `listOpen`, `resolve(id, resolution)`
  (`DB_ESCALATION_NOT_FOUND`, `DB_ESCALATION_ALREADY_RESOLVED`; the
  resolution is validated against the escalation's `createdAt`).
- `NexarBudgetRepository` — `used`, `limit`, `remaining`, `setLimit`, and
  `reserve(count)`, which runs in an immediate transaction and throws
  `BudgetExhaustedError` (`NEXAR_BUDGET_EXHAUSTED`) without changing anything
  when the limit would be exceeded. Two connections to the same file are
  serialised by the write lock.
