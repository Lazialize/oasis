# `structure/examples`

This rule checks every Example Object in the document — those in `components/examples`, in inline `examples` maps on Media Type Objects and Parameter Objects (resolving `$ref`s along the way) — for structural correctness. It validates the original `value`/`externalValue` model and OpenAPI 3.2's `dataValue`/`serializedValue` model, including their version-specific mutual-exclusion rules and primitive types.

**Default severity:** `error`

## Version notes

OpenAPI 3.0 and 3.1 support `value` and `externalValue`. OpenAPI 3.2 additionally supports `dataValue` and `serializedValue`: `dataValue` cannot coexist with `value`, while `serializedValue` cannot coexist with `value` or `externalValue`.

## Options

No options.

## Examples

### ❌ Bad

```yaml
paths:
  /pets:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
              examples:
                bad:
                  value:
                    name: Fido
                  externalValue: https://example.com/pet.json
                  unknownKey: nope
```

Reports `"...examples" example "bad" has unknown key "unknownKey"` and `"...examples" example "bad" must not set both "value" and "externalValue".`

### ✅ Good

```yaml
paths:
  /pets:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
              examples:
                sample:
                  summary: A typical pet
                  value:
                    name: Fido
```
