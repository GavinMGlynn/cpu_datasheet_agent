# query

The question this project was built to answer: find a cheaper part that still
does the job (Module 17). Import from `src/query/index.ts`.

## Asking

```
npx tsx bin/chip-run.ts alternates TPS54331DR --vin 8-28 --iout 2 --qty 100 --output adjustable
```

or `find_alternates` over MCP, with the same shape. `findAlternates(repositories,
query)` is the function underneath; it reads stored parts and nothing else —
no model, no network, no spend.

## What filters, and what only ranks

**Every constraint filters.** The input range has to be covered end to end: a
part that manages most of it manages none of it. The output current has to be
at least what was asked for. The classification axes — topology, integration,
output type, package family, temperature grade, features — have to match
exactly, and every feature asked for has to be present.

**Price only ranks.** A part with no price in the currency asked about is
still offered, because it met the constraints; it sorts last, because
"cheaper" is not something we know about it. Prices are never converted
between currencies: this project holds no exchange rate, and a ranking built
on a guessed one would be a ranking of the guess.

The unit price is read at the quantity asked about, from the highest price
break at or below it. Below the lowest break there is no price — a reel of
3000 says nothing about buying one.

`outputType` is not in the module's original constraint list. It was added the
first time the query answered for real, when a fixed 5 V part came back as the
cheapest alternate to an adjustable one. It covered the input range and the
current, and it was not an alternate.

## What is never offered

A part whose values no verification pass has confirmed, unless the caller
passes `includeUnverified`: recommending a replacement on the strength of an
unchecked reading is how a wrong absolute maximum reaches a board. A part that
needs a person, or was rejected, is never offered at all, however cheap.

Anything left out is listed in `excluded` with the reason, so the answer says
what it did not say.

## The disclaimer is part of the answer

Every result carries `pinCompatibility: 'not_assessed'` on each candidate and
the disclaimer text on the result. Nothing in this system reads a pinout, a
footprint or a reference design, so nothing in this system can tell you a part
drops in. `renderAlternates` ends every answer with it, and a test asserts
that — including when there is nothing to offer.
