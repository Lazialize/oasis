---
"@oasis/linter": minor
---

Five new built-in lint rules: `operation-success-response` (warn — every operation has a 2xx/3xx
response), `no-duplicate-paths` (error — path templates that are equivalent up to parameter names,
e.g. `/users/{id}` vs `/users/{userId}`), `security-defined` (error — every scheme name referenced
in a `security` requirement exists in `components/securitySchemes`), `tags-defined` (off by
default — operation tags are declared in the root `tags` list), and `no-unused-tags` (warn — root
`tags` entries are used by at least one operation).
