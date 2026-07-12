---
"@oasis/core": patch
"@oasis/linter": patch
---

Lint performance: memoize `$ref` scanning and the `paths`/`webhooks`/`components` traversal
helpers (`iteratePathItems`, `iterateOperations`, `iterateSchemas`, `iterateMediaTypes`) so
repeated calls from independent rules within a single `lint()` run reuse work instead of
re-walking the whole document graph each time; also cache YAML map key lookups so resolving a
`$ref` into a large `components/schemas` map is no longer a linear scan per lookup. No behavior
change — output is identical, just faster on large/multi-file specs.
