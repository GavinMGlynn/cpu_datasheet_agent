# log

Structured logging and the tool-call ledger (Module 2). Import from
`src/log/index.ts`.

## Logger (`logger.ts`)

`createLogger({ level, sink?, redact?, clock?, fields? })` returns a `Logger`
with `debug`, `info`, `warn`, `error`, and `child(fields)`. Each record is one
JSON object per line: `ts`, `level`, `msg`, then bound fields, then call-site
fields (later ones win). Records below `level` are dropped before any work.
The default sink is `stderrSink`, which writes to stderr and never stdout;
stdout belongs to the MCP transport. `isLogLevel` guards strings.

## Redaction (`redact.ts`)

`redact(value, options)` returns a JSON-safe copy with secrets removed:

- exact secret values (`secrets`, at least `MIN_SECRET_LENGTH` characters)
  are replaced wherever they appear inside strings;
- secret-shaped text (`patterns`, default `DEFAULT_SECRET_PATTERNS`: bearer
  tokens, `sk-ant-` keys, GitHub tokens) is replaced;
- string values under secret-looking keys (`keyPatterns`, default
  `DEFAULT_KEY_PATTERNS`: secret, token, password, api key, authorization,
  client id) are replaced wholesale;
- errors become their JSON form, dates ISO strings, bigints strings;
  functions and symbols are dropped from objects and become `null` in
  arrays; cycles become `"[circular]"`.

`createRedactor(options)` binds options once. `secretsFromConfig(config)`
collects the credential values present in a validated `Config`.

## Ledger (`ledger.ts`)

`new ToolCallLedger({ dir, sessionId, clock?, idGenerator?, redact?,
sidecarThresholdBytes? })`:

- `begin(tool, input, { spendsQuota, parentId? })` registers a call and
  returns its id.
- `end(id, { output } | { error })` redacts, validates the completed
  `ToolCallRecord` (throwing `ValidationError` before touching the disk if the
  output is not JSON), appends one line to `dir/YYYY-MM-DD.jsonl` named by
  the call's UTC start date, and resolves once the line is written. Outputs
  larger than the threshold (default 64 KiB) are written to
  `dir/blobs/<sha256>.json` and the record stores a `BlobRef`
  (`{ $blob: { path, sha256, bytes } }`).
- Writes are queued so concurrent calls never interleave; a failed write
  rejects that call's `end` and later writes still run. `flush()` resolves
  when the queue is empty.
- `toErrorJson(error)` serialises any thrown value; `ledgerFileName(date)`
  gives the day file name.

Errors: `LedgerError` with `LEDGER_UNKNOWN_CALL` (ending an id that was never
begun, or already ended).

## Reader (`ledger-reader.ts`)

- `readLedger(dir, { sessionId?, tool?, from?, to? }, onMalformed)` streams
  records across day files, oldest first. Blank lines are skipped; any other
  line that is not valid JSON or not a valid `ToolCallRecord` is passed to
  `onMalformed` with file, line number, and reason, then skipped. The callback
  is mandatory so nothing is dropped silently.
- `listLedgerFiles(dir)` lists day files sorted; a missing directory yields
  none, any other failure is `LedgerReadError` (`LEDGER_DIR_UNREADABLE`).
- `isBlobRef(value)` and `readBlob(dir, ref)` (`LEDGER_BLOB_MISSING`).

## Wrapper (`with-ledger.ts`)

`withLedger(ledger, { name, spendsQuota }, handler)` returns
`(input, parentId?) => Promise<output>`. Every invocation is begun before the
handler runs and ended with its output, or with its thrown error, which is
rethrown unchanged once the record is on disk. The handler receives
`{ callId }` so nested calls can link to their parent. The tool registry
(Module 12) registers handlers only through this wrapper.
