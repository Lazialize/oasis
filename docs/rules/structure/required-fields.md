# `structure/required-fields`

This rule checks that the document root has the fields every OpenAPI document must have: an `openapi` field, an `info` object containing non-empty string `title` and `version` fields, and a top-level content section (`paths` in 3.0; in 3.1/3.2, at least one of `paths`, `webhooks`, or `components`). A document missing these fields isn't a valid OpenAPI document at all — tooling that generates clients, servers, or docs from it will fail outright or silently produce broken output (e.g. an SDK with no title/version metadata, or no operations to generate).

**Default severity:** `error`

## Version notes

In OpenAPI 3.0, `paths` is required at the document root; if it's missing, the rule reports a missing `"paths"` field. In OpenAPI 3.1 and 3.2, `paths` is optional because a document can instead (or additionally) describe itself entirely through `webhooks` or reusable `components` — so this rule only reports an error if the document has none of `paths`, `webhooks`, or `components` present. The `info.title`/`info.version` and top-level `openapi` checks are identical across supported versions.

## Options

No options.

## Examples

### ❌ Bad

```yaml
openapi: 3.0.3
info:
  title: T
  version: "1.0.0"
```

This document has no `paths`, so it triggers `Missing required field "paths".` under OpenAPI 3.0.

### ✅ Good

```yaml
openapi: 3.0.3
info:
  title: T
  version: "1.0.0"
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: OK
```
