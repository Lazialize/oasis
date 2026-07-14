---
"@oasis/linter": patch
---

Traverse every OpenAPI 3.1 JSON Schema applicator consistently (#40). The shared schema walker
(`walkSchemaTree`) is now a single version-aware traversal with complete 3.0 and 3.1 child
semantics, replacing the previous opt-in flags that let rules miss nested schemas. On 3.1 documents
it now descends into `patternProperties`, `prefixItems`, `if`/`then`/`else`, `contains`,
`propertyNames`, `dependentSchemas`, `$defs`, `unevaluatedItems`, `unevaluatedProperties`, and
`contentSchema` in addition to the previously covered applicators. All schema-inspecting rules
(`structure/schema-nullable`, `structure/schema-keywords`, `structure/discriminator`,
`structure/xml`, `style/naming-convention`, `examples/schema-match`) reach every applicable schema
position — e.g. a forbidden `nullable: true` under `$defs` is now reported.
