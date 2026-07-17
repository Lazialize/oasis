---
"@oasis/core": patch
"@oasis/bundler": patch
"@oasis/linter": patch
"@oasis/server": patch
---

Resolve OpenAPI 3.1 schema references and anchors against the nearest canonical `$id` resource, including standalone external Schema Documents and aliased schemas reached under distinct resource scopes.
