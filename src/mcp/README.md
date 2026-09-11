# mcp

The tool surface over MCP: one registry, two thin adapters (Module 12).
Import from `src/mcp/index.ts`.

## Two adapters, one surface

`createMcpServer(registry, context)` builds a `McpServer` from
`@modelcontextprotocol/server` (v2) for external clients — Claude Code, the
MCP Inspector, anything that speaks the protocol. `serveMcpStdio()` runs it
over stdio and is what `bin/chip-mcp.ts` calls.

`createInProcessServer(registry, context)` builds the same tools into an Agent
SDK in-process server for the runner (M14). `sdkTools(registry, context)`
exposes the definitions on their own, which is how the tests hold them: the
Agent SDK bundles its own major line of the MCP SDK, so its server cannot be
driven by a v2 client, and what is worth proving is that every tool is there
and behaves.

A test asserts the two adapters expose identical tool lists, in the same
order. That is the whole claim of building them from one registry.

## What crosses the wire

- **Results** are JSON text, plus `structuredContent` when the tool's output
  is an object schema. The spending tools answer with a union — the result, or
  a request to confirm — which is not an object schema, so those travel as
  text alone.
- **`render_page`** answers with an image block. A model that can see the page
  is the reason that tool exists, and a base64 string inside a JSON blob is
  not that.
- **Failures** come back as error results carrying the code
  (`{ name, code, message, details }`), not as transport failures: the model
  is meant to read the code and decide what to do next, which it cannot do
  with a broken connection. Anything that is not one of this project's errors
  is described as `UNKNOWN` with whatever `String` makes of it.

## Strictness is advertised, not just enforced

Tool inputs are strict objects, and that is what the server advertises:
`additionalProperties: false` in the JSON Schema, and an unrecognised argument
is refused with the key in the message. The SDK's registration type names a
stripping object, so one cast in `server.ts` restates that a stricter schema
is a valid schema. Advertising the loose form would have the transport quietly
drop an argument the tool never agreed to ignore, which is the coercion this
project refuses everywhere else.

## stdout belongs to the protocol

Every log line goes to stderr (D09). A test asserts that a full session writes
nothing to stdout, because a stray line there does not look untidy — it
corrupts the session.

## Running it

```
npx tsx bin/chip-mcp.ts
```

Configuration comes from the environment (`src/config.ts`), so the server
needs `DATA_DIR` and whichever distributor credentials the run should have.
`serveMcpStdio` returns when the session ends: SIGINT, SIGTERM, or stdin
closing, which is how a client ends an stdio session.
