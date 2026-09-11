# tools

The tool surface: every capability the agent has, with schemas on both sides,
a policy for anything that spends, and a record of every call (Module 12).
Import from `src/tools/index.ts`.

## The registry

`defineTool(spec)` turns typed schemas and a handler into a `ToolDefinition`;
`buildRegistry()` collects them all. A tool is written against its own
schemas and stored erased to `unknown` in and `unknown` out — `run` closes
over the typed handler and parses the input before calling it, so nothing is
cast.

`ToolRegistry.call(name, input, context, parentId?)`:

1. parses the input against the tool's schema, rejecting with
   `ValidationError`;
2. runs the handler, wrapped in `withLedger`, so the call is recorded whatever
   the transport and whatever happens;
3. parses the output against the tool's own schema. A handler that breaks its
   own contract raises `TOOL_OUTPUT_INVALID` — a different fault from the
   caller's bad input, and worth telling apart.

Registering two tools under one name is refused (`TOOL_DUPLICATE`): two tools
answering to a name is a wiring mistake that would otherwise surface as the
wrong one running.

## The tools

| Tool | Spends | Does |
| --- | --- | --- |
| `resolve_mpn` | yes | Normalise, decode, ask the distributors, match. Escalates `ambiguous_mpn` rather than guessing. |
| `fetch_offers` | yes | Offers, parametric facts with provenance, and the datasheet URL. A distributor that fails is reported, not thrown. |
| `fetch_datasheet` | no | Download a PDF, record it by digest, link the part number to it. |
| `pdf_info`, `find_pages`, `read_pages`, `render_page` | no | Page count, section locations, page text with shape metrics, and a page as a PNG. |
| `normalise_value` | no | Datasheet text to a canonical quantity, range, or temperature range. |
| `reconcile_parameters` | no | Datasheet against distributor; stores any safety escalation. |
| `classify_part` | no | The categorisation axes, naming what it could not decide. |
| `upsert_part`, `get_part`, `search_parts` | no | Store and query parts. `upsert_part` validates the whole aggregate and rejects it. |
| `record_verification` | no | One verification verdict against a stored parameter. |
| `ask_human`, `list_escalations` | no | Hand a question to a person; read what is waiting. |
| `nexar_budget_status`, `cache_stats` | no | What has been spent, and what the cache has done. |

## Spending

A tool that can spend distributor quota declares `spendsQuota` and accepts
`confirmSpend`. `QuotaPolicy` decides what a run may do, and is a separate
object so the agent runner can set it per run:

| Policy | Unconfirmed call | Confirmed call |
| --- | --- | --- |
| `DEFAULT_QUOTA_POLICY` | answered from the cache, else `needs_confirmation` | spends |
| `NO_SPEND_POLICY` | answered from the cache, else `needs_confirmation` | `denied` |
| `autoConfirm` | spends | spends |

**An unconfirmed call is not a refusal.** It runs against the cache, and only
a question that would actually cost something comes back as
`needs_confirmation` with the input to resend. This runs the same code path
the spending call runs — `cacheOnly` on the cache itself — so the answer to
"is this free?" cannot drift from what the real call does.

`fetch_datasheet` is not gated: a manufacturer's PDF costs nothing and is
what every extraction reads. The fetcher's own retry and size limits are what
keep it polite.

## Context

`createToolContext({ config })` wires one context from configuration: the
cache and its store, the database, the PDF toolkit, the ledger with the
config's secrets redacted, and whichever distributors have credentials. A
distributor with no credentials is left out rather than built and made to fail
on first use; the tools report it as unavailable, which is a fact about the
run rather than an error in the middle of one.

`headless` (default true) says nobody is watching: `ask_human` records the
question, marks the part `needs_human`, and returns, because a run that waits
for an answer that cannot come is a run that hangs.

## Schemas

`src/tools/schemas.ts` holds Zod schemas mirroring types that are TypeScript
interfaces elsewhere — decoded part numbers, candidates, page metrics,
distributor facts, reconciliation results. They are a published contract, not
a dump of an internal type, and each has a type test asserting it still
matches the type it mirrors, so the two cannot drift apart quietly.
