# `structure/field-types`

This rule checks the JSON types of common top-level and operation-level fields: `tags`, `servers`, and `security` at the document root must be arrays; `paths` and `components` must be objects, and each `components.<category>` (schemas, responses, parameters, etc.) must be an object; each Path Item under `paths` must be an object, its `parameters` must be an array, and each HTTP-method key on it must map to an object. Within each operation, `parameters`/`tags` must be arrays, `requestBody` must be an object, `responses` is required and must be an object whose keys are valid HTTP status codes (case-sensitive: `2XX`-style uppercase ranges, lowercase `default`, or an extension `x-*` field). A present but empty Responses Object (`responses: {}`) is also flagged — the Responses Object must contain at least one response code, `default`, or extension field to ever be satisfiable. Catching these type mismatches early prevents confusing failures deeper in the toolchain — e.g. code generators that assume `tags` is iterable, or LSP/bundler logic that assumes `responses` keys are status codes.

## Parameter Objects

Every Parameter Object reachable from `components/parameters`, Path Item `parameters`, Operation `parameters`, and any (same-document or cross-file) Reference Object pointing at one of those, is validated — deduplicated by resolved location so a parameter shared via `$ref` (or also registered under `components/parameters`) is only checked once, with diagnostics attributed to whichever document actually owns the parameter node:

- A string `name` and an `in` set to one of `query`/`header`/`path`/`cookie` are required; OpenAPI 3.2 additionally supports `querystring` with `content`.
- `in: path` parameters must set `required: true`.
- `schema` and `content` are mutually exclusive; when `content` is used it must be an object with exactly one entry.
- `style` (if present) must be one of the values valid for the parameter's `in`; OpenAPI 3.2 adds the `cookie` style for cookie parameters.
- `explode` (if present) must be a boolean.
- `allowEmptyValue`/`allowReserved` (if present) must be booleans; `allowReserved` follows the broader OpenAPI 3.2 locations.

**Default severity:** `error`

## Version notes

Path-item and operation-level checks are driven by the shared path-item/operation iterators, which follow path-item `$ref`s to their target file (diagnostics are attributed there) and, on OpenAPI 3.1/3.2 documents, also walk the root `webhooks` map the same way as `paths`. OpenAPI 3.2 traversal additionally includes `query` and `additionalOperations`. Response `description` is required before 3.2 and optional in 3.2, where `summary` is also available.

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
