---
"@oasis/bundler": patch
---

fix(bundler): preserve version- and object-specific `$ref` sibling semantics when dereferencing.
`--dereference` no longer shallow-merges every sibling of a `$ref` onto the inlined target, which
silently changed document meaning. Sibling handling now branches on the OpenAPI version and whether
the `$ref` sits in a Schema Object or a Reference Object position: OpenAPI 3.0 Reference Object (and
Schema Object) siblings are ignored per JSON Reference semantics; OpenAPI 3.1 Reference Object
siblings allow only `summary`/`description` overrides; and OpenAPI 3.1 Schema Object siblings are
preserved as a conjunction via `allOf: [<target>, {<siblings>}]` so conflicting keywords, arrays, and
boolean-schema targets are never lost (`x-*` extension annotations attach directly rather than joining
the conjunction). Applies to both YAML and JSON output (#87).
