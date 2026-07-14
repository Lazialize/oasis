---
"@oasis/linter": patch
"@oasis/server": patch
---

Centralize version-aware OpenAPI object shape validation and complete the LSP completion contexts
(#65, #60).

- **Linter (#65):** a declarative, version-aware object-shape table (`object-shape.ts`) now
  describes every OpenAPI Object — required fields, per-field value types, 3.0 vs 3.1 field
  availability, mutually exclusive field groups, `x-*` extension allowance, and referenceable
  (`$ref`) locations. A new `structure/object-shape` rule validates the metadata objects no other
  rule covered (Info, Contact, License, Tag, External Documentation), preserving each
  diagnostic's source range and owning document. Existing `structure/*` rules and their diagnostics
  are unchanged; the table is exported from `@oasis/linter` as the shared foundation.
- **Server (#60):** completion contexts are driven from that shared table, so suggestions offer only
  the keys legal at the cursor for the document's version. Newly covered: root `webhooks` and
  `jsonSchemaDialect` (3.1), `components.headers`/`examples`/`links`/`callbacks` and 3.1
  `pathItems`, Header/Example/Link/Callback/Encoding/OAuth Flow(s) Objects, and every JSON Schema
  2020-12 applicator (`$defs`, `prefixItems`, `patternProperties`, `if`/`then`/`else`,
  `dependentSchemas`, `unevaluatedProperties`/`unevaluatedItems`, `propertyNames`, `contains`).
  Version-specific fields differ correctly between 3.0 and 3.1 (e.g. `nullable`/`example` vs
  `const`/`examples`/`$defs`; `info.summary`, `license.identifier`).
