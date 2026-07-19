# `structure/encoding`

This rule checks Encoding Object entries under a Media Type Object's `encoding` map (e.g. for `multipart/form-data` request bodies). When the media type's `schema` resolves — within the workspace graph — to an inline object schema with a literal `properties` map, each encoding key must match one of those property names (encoding entries for composed schemas, free-form objects, or unresolvable refs are skipped rather than guessed at, since the property set can't be determined statically). For each entry, `contentType` and `style` must be recognized strings, and `explode`/`allowReserved` must be booleans. OpenAPI 3.2's `itemSchema`, `prefixEncoding`, `itemEncoding`, and nested `encoding` structures are walked recursively and checked for their required mutual exclusions.

**Default severity:** `error`

## Version notes

OpenAPI 3.0 and 3.1 support the original schema/encoding map model. OpenAPI 3.2 additionally supports stream/sequential media descriptions through `itemSchema`, `prefixEncoding`, `itemEncoding`, and nested Encoding Objects; these fields are rejected on earlier versions.

## Options

No options.

## Examples

### ❌ Bad

```yaml
requestBody:
  content:
    multipart/form-data:
      schema:
        type: object
        properties:
          file:
            type: string
            format: binary
      encoding:
        file:
          contentType: application/octet-stream
        notAProperty:
          contentType: text/plain
        badShape:
          style: bogusStyle
          explode: yes
```

Reports `encoding key "notAProperty" does not match any property in the media type's schema.` and `encoding "badShape" "style" must be one of: form, spaceDelimited, pipeDelimited, deepObject.`

### ✅ Good

```yaml
requestBody:
  content:
    multipart/form-data:
      schema:
        type: object
        properties:
          file:
            type: string
            format: binary
      encoding:
        file:
          contentType: application/octet-stream
          explode: true
```
