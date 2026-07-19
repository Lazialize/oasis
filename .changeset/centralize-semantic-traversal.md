---
"@oasis/core": patch
---

refactor(core): centralize the version-aware OpenAPI object-edge and JSON Schema
applicator transition tables in a single internal module (`semantic-traversal.ts`).
Reference discovery (`findRefs`) and anchor/resource indexing (`buildAnchorIndex`)
previously each maintained their own copies of the schema-applicator key sets, HTTP
method set, and object-kind transition functions, so a new applicator or object
position could be added to one walker but silently omitted from the other. Both
walkers now consume one authoritative table while keeping their specialized outputs
and caches. No behavior change.
