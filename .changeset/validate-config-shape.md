---
"@oasis/linter": patch
"@oasis/cli": patch
---

fix: validate `oasis.config.jsonc` structure before resolving lint configuration (#33)

Config files were syntax-checked as JSONC but then cast directly to the config type, so a
structurally invalid shape (e.g. `"lint": {"overrides": {}}` where an array is expected) crashed
`resolveConfig` with a TypeError. The complete config shape (`entries`, `lint`, `lint.rules`,
`lint.overrides` and each override's `files`/`rules`) is now validated at the load boundary:
invalid fields are dropped and reported as source-ranged `oasis/config` diagnostics (CLI) or
config warnings (LSP) instead of crashing or being silently coerced.
