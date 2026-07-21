# `structure/object-shape`

This rule validates OpenAPI objects against a single version-aware shape table (`packages/linter/src/object-shape.ts`). It checks required fields, JSON types, version availability, mutual exclusions, and unknown non-extension keys. The table includes OpenAPI 3.2 additions such as root `$self`, Server `name`, Tag `summary`/`parent`/`kind`, Discriminator `defaultMapping`, and XML `nodeType`.

The same shape table drives the LSP server's key completions, so the keys the editor suggests and the keys the linter accepts can't drift apart. Objects with their own dedicated rules (Schema, Parameter, Response, Security Scheme, Server, Path Item, Operation, ...) are intentionally left to those rules to avoid duplicate diagnostics — for example Server Objects are fully validated by [`structure/server-variables`](server-variables.md).

This includes the root OpenAPI Object itself: unknown top-level fields (typos, or fields copied from another OpenAPI version) are reported, and version-gated root fields such as `webhooks` and `jsonSchemaDialect` (added in 3.1) are rejected on 3.0 documents. The root's `openapi`/`info` required-ness, `openapi`/`$self` type and version, and the array/object types of `servers`, `tags`, `security`, `paths`, `components`, and `webhooks` are left to [`structure/required-fields`](required-fields.md), [`structure/openapi-version`](openapi-version.md), and [`structure/field-types`](field-types.md) respectively, so this rule doesn't duplicate those diagnostics.

**Default severity:** `error`

## Version notes

- OpenAPI 3.1 adds `info.summary`, `license.identifier`, and the root `webhooks`/`jsonSchemaDialect` fields; using them on a 3.0 document is reported.
- On 3.1, `license.identifier` and `license.url` are mutually exclusive.

## Options

No options.

## Examples

### ❌ Bad

```yaml
openapi: 3.1.0
info:
  title: My API
  version: "1.0.0"
  license:
    identifier: MIT
    url: https://example.com/license   # identifier and url are mutually exclusive
externalDocs:
  description: More docs                 # missing required "url"
tags:
  - description: Pet operations          # missing required "name"
```

Reports the mutually-exclusive license fields, the External Documentation Object's missing `url`, and the Tag Object's missing `name`.

```yaml
openapi: 3.0.3
info: { title: T, version: v }
paths: {}
webhooks: {}            # added in 3.1; not valid on a 3.0 document
jsonSchemaDialect: 42   # added in 3.1, and wrong type besides
typoField: true         # unknown root field
```

Reports `webhooks` and `jsonSchemaDialect` as not valid in OpenAPI 3.0, and `typoField` as an unknown root field.

### ✅ Good

```yaml
openapi: 3.1.0
info:
  title: My API
  version: "1.0.0"
  summary: A concise API for managing pets
  license:
    name: MIT
    identifier: MIT
servers:
  - url: https://api.example.com
    description: Production
tags:
  - name: pets
    description: Pet operations
    externalDocs:
      url: https://docs.example.com/pets
```
