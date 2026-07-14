# `structure/object-shape`

This rule validates the OpenAPI metadata objects that the other `structure/*` rules don't already cover — the Info, Contact, License, Tag, and External Documentation Objects — against a single version-aware shape table (`packages/linter/src/object-shape.ts`). For each of these objects it checks required fields are present, each field holds a value of the correct JSON type, fields only appear in a document version that allows them (e.g. `info.summary` and `license.identifier` are 3.1-only), mutually exclusive fields don't co-occur (`license.identifier` vs `license.url`), and unknown non-extension keys are flagged (`x-*` extensions are allowed).

The same shape table drives the LSP server's key completions, so the keys the editor suggests and the keys the linter accepts can't drift apart. Objects with their own dedicated rules (Schema, Parameter, Response, Security Scheme, Server, Path Item, Operation, ...) are intentionally left to those rules to avoid duplicate diagnostics — for example Server Objects are fully validated by [`structure/server-variables`](server-variables.md).

**Default severity:** `error`

## Version notes

- OpenAPI 3.1 adds `info.summary` and `license.identifier`; using them on a 3.0 document is reported.
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
