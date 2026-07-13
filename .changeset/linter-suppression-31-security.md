---
"@oasis/core": patch
"@oasis/linter": patch
---

fix: suppression-comment and rule correctness fixes ahead of 1.0

- `# oasis-disable-*` directives are now extracted from real YAML comment tokens (CST), so directive-looking text inside a block scalar or quoted string no longer silently suppresses diagnostics
- `structure/field-types` and `structure/callbacks` no longer report `responses` as a missing required field on OpenAPI 3.1 documents (it is optional since 3.1)
- `security/defined` now also validates scopes: oauth2 scopes must be declared by one of the scheme's flows, and only `oauth2`/`openIdConnect` requirements may list scopes
