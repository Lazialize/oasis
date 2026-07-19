---
"@oasis/linter": patch
---

fix(linter): deduplicate JSON Schema type-name validation across schema rules. The `structure/schema-keywords` rule is responsible for validating type-name correctness; `structure/schema-nullable` was duplicating this check, causing both rules to report the same error for invalid types like `type: wat`. Removed type-name validation from `structure/schema-nullable`, which now focuses exclusively on version-appropriate nullability forms: rejecting `type` arrays in 3.0, `type: null` scalars in 3.0, and `nullable` in 3.1. The `structure/schema-keywords` rule independently validates all type names for both scalar and array forms across both OpenAPI versions.
