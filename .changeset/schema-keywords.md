---
"@oasis/linter": minor
---

New `structure/schema-keywords` rule validates Schema Object keywords against the document's
dialect: JSON Schema 2020-12 keywords only valid in OpenAPI 3.1 (`const`, `prefixItems`,
`contentMediaType`, `contentEncoding`, `patternProperties`, `propertyNames`,
`unevaluatedProperties`, `unevaluatedItems`, `dependentRequired`, `dependentSchemas`,
`if`/`then`/`else`, `$defs`, `examples`) are flagged on 3.0, and `exclusiveMinimum`/
`exclusiveMaximum` must be boolean on 3.0 vs numeric on 3.1. It also checks value types (`type`,
numeric bounds, `pattern`, `required`, `enum`, `items`, `properties`, `additionalProperties`,
`format`), internal consistency (min/max contradictions, `required` properties excluded by
`additionalProperties: false`), and `$ref` sibling keys (ignored — and flagged — in 3.0, legal in
3.1). Defaults to `error` severity. `nullable` and 3.0 `type` array/`null` handling remain the
responsibility of the existing `structure/schema-nullable` rule to avoid double-reporting.
