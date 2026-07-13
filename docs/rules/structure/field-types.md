# `structure/field-types`

This rule checks the JSON types of common top-level and operation-level fields: `tags`, `servers`, and `security` at the document root must be arrays; `paths` and `components` must be objects, and each `components.<category>` (schemas, responses, parameters, etc.) must be an object; each Path Item under `paths` must be an object, its `parameters` must be an array, and each HTTP-method key on it must map to an object. Within each operation, `parameters`/`tags` must be arrays, `requestBody` must be an object, `responses` is required and must be an object whose keys are valid HTTP status codes (case-sensitive: `2XX`-style uppercase ranges or lowercase `default`), and each inline parameter must have a string `name` and an `in` set to one of `query`/`header`/`path`/`cookie`. Catching these type mismatches early prevents confusing failures deeper in the toolchain — e.g. code generators that assume `tags` is iterable, or LSP/bundler logic that assumes `responses` keys are status codes.

**Default severity:** `error`

## Version notes

Path-item and operation-level checks are driven by the shared path-item/operation iterators, which follow path-item `$ref`s to their target file (diagnostics are attributed there) and, on OpenAPI 3.1 documents, also walk the root `webhooks` map the same way as `paths`. Root-level checks (`tags`, `servers`, `security`, `components`) apply identically to OpenAPI 3.0 and 3.1 documents.

## Options

No options.

## Examples

### ❌ Bad

```yaml
openapi: 3.0.3
info:
  title: T
  version: "1.0.0"
tags: not-an-array
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: OK
```

### ✅ Good

```yaml
openapi: 3.0.3
info:
  title: T
  version: "1.0.0"
tags:
  - name: pets
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: OK
```
