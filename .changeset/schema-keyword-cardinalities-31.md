---
"@oasis/linter": patch
---

fix(linter): align `structure/schema-keywords` with JSON Schema 2020-12 cardinalities in OpenAPI 3.1.
The rule previously applied OpenAPI 3.0-style assumptions to 3.1 documents: it rejected valid boolean
Schema values for `items` (e.g. `items: false`) and empty `required` arrays, while accepting an
invalid empty `type` array. OpenAPI 3.1's Schema Object follows JSON Schema 2020-12, where a Schema
may be a boolean, `required` may legally be empty, and the array form of `type` must contain at least
one entry. OpenAPI 3.0 behavior (Schema must be an object, `required` must be non-empty) is unchanged
(#102).
