# `structure/schema-nullable`

This rule checks that every schema in the document (including inline ones, walked through `properties`, `items`, `allOf`/`oneOf`/`anyOf`, and `additionalProperties`) expresses nullability correctly for the document's OpenAPI/JSON Schema dialect. Nullability syntax is one of the sharpest edges between OpenAPI 3.0 and 3.1: code that's correct in one version is invalid (or silently a no-op) in the other, and getting it wrong means generated client/server models either reject valid `null` values or fail to compile/validate at all.

**Default severity:** `error`

## Version notes

In **OpenAPI 3.0**, `type` must be a single string (JSON Schema type arrays and `type: null` don't exist in the 3.0 dialect); nullability is expressed with the separate `nullable: true` keyword alongside a type. This rule reports an error if `type` is an array, or if `type: null` is used — both are flagged as 3.1-only concepts, with a message pointing at `nullable: true` as the 3.0-correct alternative.

In **OpenAPI 3.1** (JSON Schema 2020-12), `nullable` was removed from the dialect entirely; nullability is instead expressed by including `"null"` in a `type` array (e.g. `type: [string, "null"]`). This rule reports an error whenever a 3.1 schema uses `nullable` at all, regardless of its value, pointing at the `type` array form as the replacement.

General `type`-name validity (rejecting values that aren't one of the recognized JSON Schema type names) is owned by [`structure/schema-keywords`](schema-keywords.md), not this rule.

## Options

No options.

## Examples

### ❌ Bad — OpenAPI 3.0

```yaml
openapi: 3.0.3
components:
  schemas:
    Pet:
      type: [string, "null"]
```

`"type" must be a single string in OpenAPI 3.0 (arrays are a 3.1 feature); use "nullable: true" for nullability.`

### ✅ Good — OpenAPI 3.0

```yaml
openapi: 3.0.3
components:
  schemas:
    Pet:
      type: string
      nullable: true
```

### ❌ Bad — OpenAPI 3.1

```yaml
openapi: 3.1.0
components:
  schemas:
    Pet:
      type: object
      nullable: true
```

`"nullable" is not part of OpenAPI 3.1 (JSON Schema 2020-12); express nullability with a "type" array including "null" instead.`

### ✅ Good — OpenAPI 3.1

```yaml
openapi: 3.1.0
components:
  schemas:
    Pet:
      type: [object, "null"]
```
