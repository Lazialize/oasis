---
"@oasis/linter": minor
---

New `example-schema-match` rule (default: warn): validates that `example` / `examples[].value`
values conform to their schema — on Schema Objects, Media Type Objects, and Parameter Objects,
resolving `$ref`s across the workspace. Version-aware: 3.0 `nullable` and boolean exclusive
bounds vs 3.1 type arrays, `"null"` type, `const`, `prefixItems`, and numeric exclusive bounds.
Validation is a deliberate hand-rolled subset (no JSON Schema validator dependency); schemas
using `not`, `discriminator`, or unresolved `$ref`s are skipped rather than risk false positives.
