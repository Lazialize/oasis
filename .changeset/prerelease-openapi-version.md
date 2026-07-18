---
"@oasis/linter": patch
---

fix(linter): accept prerelease suffixes in the `structure/openapi-version` rule. The rule now accepts version strings like `3.0.0-rc1` and `3.1.0-alpha.1`, matching the behavior of `@oasis/core`'s `detectVersion` function and the official OpenAPI schema, which already recognize and classify these prerelease versions correctly.
