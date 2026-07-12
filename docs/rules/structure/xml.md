# `structure/xml`

This rule checks the Schema Object `xml` field in every schema in the document (including inline ones, walked through `properties`, `items`, `allOf`/`oneOf`/`anyOf`, and `additionalProperties`): only the known keys `name`, `namespace`, `prefix`, `attribute`, `wrapped` (plus `x-` extensions) are allowed; `name`/`namespace`/`prefix` must be strings and `attribute`/`wrapped` must be booleans; and `namespace`, when present, should look like an absolute URI (a `scheme:` prefix). The `xml` field only matters to tooling that generates or validates XML representations of a schema, so a malformed or misnamed key here is easy to miss visually but breaks XML (de)serialization silently for any consumer that reads it — this rule surfaces that early.

**Default severity:** `error`

## Version notes

No version-specific behavior — this rule applies identically to OpenAPI 3.0 and 3.1 documents.

## Options

No options.

## Examples

### ❌ Bad

```yaml
components:
  schemas:
    Pet:
      type: object
      xml:
        name: 5
        namespace: not-a-uri
        attribute: maybe
        unknownKey: oops
      properties:
        name:
          type: string
```

Reports `"xml" has unknown key "unknownKey"`, `"xml.name" must be a string.`, `"xml.namespace" should be an absolute URI (e.g. "https://example.com/ns").`, and `"xml.attribute" must be a boolean.`

### ✅ Good

```yaml
components:
  schemas:
    Pet:
      type: object
      xml:
        name: pet
        namespace: https://example.com/schema
        attribute: false
      properties:
        name:
          type: string
```
