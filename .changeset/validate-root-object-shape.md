---
"@oasis/linter": patch
---

Fix `structure/object-shape` not validating the root OpenAPI Object. The rule now checks the root against its version-aware shape: unknown non-extension root fields (e.g. a typo like `typoField`) are reported, and root fields introduced in later OpenAPI versions — `webhooks` and `jsonSchemaDialect` (3.1+) — are rejected on 3.0 documents, with `jsonSchemaDialect` also type-checked as a string where it's valid. Specification extensions (`x-*`) at the root continue to be accepted. The new root checks are coordinated with `structure/required-fields`, `structure/openapi-version`, and `structure/field-types` so existing root-level diagnostics (required `openapi`/`info`, array/object field types, `$self` gating) aren't duplicated.
