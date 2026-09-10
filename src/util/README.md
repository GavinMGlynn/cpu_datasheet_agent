# util

Small pure helpers with no project dependencies.

- `deepFreeze(value)` — recursively freezes objects and arrays in place and
  returns the same reference. Primitives and `null` pass through. Cycles are
  not handled (none of the inputs frozen in this project have them).
