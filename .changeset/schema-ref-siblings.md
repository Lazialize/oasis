---
"@oasis/linter": patch
---

fix(linter): preserve Schema Object keywords declared alongside `$ref` when resolving schema roots.
`iterateSchemas` previously replaced a `$ref`-bearing schema root (a `components/schemas` entry or an
inline request/response/parameter schema) with its resolved target before schema rules ran, silently
discarding the referring node and its siblings. In OpenAPI 3.1 (JSON Schema 2020-12) those siblings
are meaningful, so `structure/schema-nullable`, `structure/schema-keywords`, and `examples/schema-match`
now evaluate them (and still check the referenced target); example validation checks an example
against both the target and the applicable siblings. In OpenAPI 3.0 the siblings remain ignored per
spec but are now flagged on schema roots too. Diagnostics keep pointing at the owning file/range of
the keyword they concern (#103).
