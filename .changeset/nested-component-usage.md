---
"@oasis/linter": patch
---

Count nested component-pointer references as component usage (#36). A `$ref` whose target lies
below a top-level component (e.g. `#/components/schemas/Foo/properties/id`, locally or across
files) now marks that component (`Foo`) as used, so `components/no-unused` no longer
false-positives on it and the remove-unused quick fix can't delete a live component.
