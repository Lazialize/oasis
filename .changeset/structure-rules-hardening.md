---
"@oasis/linter": patch
---

Harden several `structure/*` rules that were silently skipping malformed input instead of reporting it:

- `structure/schema-keywords` now reports `exclusiveMinimum`/`exclusiveMaximum` values of any non-conforming node kind (object, array, `null`, string, ...), not just the other version's scalar form (#41)
