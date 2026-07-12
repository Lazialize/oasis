---
"@oasis/linter": minor
---

Broader lint traversal: operation-level rules (`operation-*`, `security-defined`, `tags-defined`,
`naming-convention`, `example-schema-match`) now also cover operations under the root `webhooks`
map on 3.1 documents (`operationId` uniqueness spans paths and webhooks; `no-unused-components`
counts webhook `$ref`s). Path-shaped rules (`path-params-defined`, `no-duplicate-paths`) stay
`paths`-only since webhook keys are arbitrary names, not URL templates. Schema rules
(`structure/schema-nullable`, `naming-convention` property names, `example-schema-match`) now
check every schema site — inline request/response media-type, parameter and header schemas
(operation- and components-level) in addition to `components/schemas` — via a shared walker that
resolves `$ref`s through the workspace and visits each shared schema once.
