# src

Top-level modules that every other module may import:

- `errors.ts` — `ChipAgentError` base class (`code`, frozen `details`, optional
  `cause`, stack-free `toJSON()`), and the `isChipAgentError` guard. Every
  deliberate throw in the project extends it and sets a stable `code`.
- `config.ts` — `loadConfig(env, { cwd })` validates the environment with a
  strict Zod schema and returns a deeply frozen `Config`. Blank values count
  as unset. Adapter credentials are optional here and demanded by the adapter
  that needs them. Throws `ConfigError` (`CONFIG_INVALID`) listing every
  problem at once. `ENV_VARIABLE_NAMES` is the authoritative variable list; a
  test keeps `.env.example` in sync with it.
- `util/` — small pure helpers (`deepFreeze`).

Module directories are described by their own `README.md`.
