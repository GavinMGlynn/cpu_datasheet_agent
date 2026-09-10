# gate

Static gate scanner (Module 0). Finds tokens that must never be committed in
code directories: unfinished-work markers, skipped, focused, or pending tests,
type-check suppressions, and lint suppressions. The entry point is
`scripts/gate.ts`; the logic lives here so it is covered by tests.

## API

- `runGate(roots, { cwd, rules?, extensions?, ignoreDirs? })` — scans every
  file under the roots and returns `{ filesScanned, violations }`.
- `collectFiles(roots, options)` — recursive file listing, sorted, filtered by
  extension (`DEFAULT_EXTENSIONS`: `.ts .mts .cts .js .mjs .cjs`), skipping
  `DEFAULT_IGNORE_DIRS` (`node_modules`, `dist`, `coverage`).
- `scanFile(file, rules, cwd)` — violations for one file, with 1-based line
  numbers and the trimmed offending line.
- `formatViolations(violations)` — `file:line: rule: text`, one per line.
- `isTestFile(file)` — true for `*.test.{ts,mts,cts,js,mjs,cjs}`.
- `DEFAULT_RULES` — the rule set. The `ts-expect-error` rule is exempt in
  test files, where that directive is the proof that a type error exists.

## Errors

All are `GateError` (extends `ChipAgentError`):

- `GATE_ROOT_MISSING` — a root does not exist. The gate never silently scans
  nothing.
- `GATE_ROOT_NOT_DIRECTORY` — a root is a file.
- `GATE_RULE_STATEFUL` — a rule pattern uses the `g` or `y` flag, which would
  make `RegExp.test` stateful across lines.

## Invariants

- Rule tokens are assembled from fragments inside `scan.ts` and its test so
  both files pass their own scan. Do not write a forbidden token literally in
  any file under `src/`, `test/`, `scripts/`, or `bin/`, including in rule
  names or test constants.
- Rules are tested per line, case-sensitively.
