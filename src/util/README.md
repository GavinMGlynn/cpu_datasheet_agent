# util

Small pure helpers with no project dependencies beyond the error base class.

- `deepFreeze(value)` — recursively freezes objects and arrays in place and
  returns the same reference. Primitives and `null` pass through. Cycles are
  not handled (none of the inputs frozen in this project have them).
- `group(match, index)` / `optionalGroup(match, index)` — read regex capture
  groups. `noUncheckedIndexedAccess` types every group as possibly undefined,
  which would force an unreachable fallback at each use; `group` centralises
  that check and throws `RegexGroupError` (`REGEX_GROUP_MISSING`) so a pattern
  edited to make a group optional fails loudly instead of silently yielding an
  empty string. Use `optionalGroup` where the pattern may legitimately leave a
  group unfilled.
