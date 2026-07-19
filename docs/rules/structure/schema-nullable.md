# `structure/schema-nullable`

This rule checks that every schema in the document (including inline ones) expresses nullability correctly for the document's OpenAPI/JSON Schema dialect. OpenAPI 3.1 and 3.2 use JSON Schema 2020-12 nullability, while OpenAPI 3.0 uses `nullable`.

**Default severity:** `error`

## Version notes

In **OpenAPI 3.0**, `type` must be a single string and nullability is expressed with `nullable: true`. In **OpenAPI 3.1/3.2**, type arrays and the `null` type are available and `nullable` is rejected.

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
