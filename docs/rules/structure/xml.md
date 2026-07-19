# `structure/xml`

This rule checks the Schema Object `xml` field in every schema in the document (including inline ones, walked through `properties`, `items`, `allOf`/`oneOf`/`anyOf`, and `additionalProperties`): known keys and primitive types are validated, and `namespace`, when present, should look like an absolute URI. OpenAPI 3.2's `nodeType` must be one of `element`, `attribute`, `text`, `cdata`, or `none`, and cannot coexist with the legacy `attribute` or `wrapped` fields.

**Default severity:** `error`

## Version notes

OpenAPI 3.0 and 3.1 support `name`, `namespace`, `prefix`, `attribute`, and `wrapped`. OpenAPI 3.2 adds `nodeType` and makes it mutually exclusive with `attribute` and `wrapped`.

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
